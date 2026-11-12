/* ZNC1 参考网卡。
   一条 WebSocket 连接，串行 request/reply。只搬原始以太网帧，
   不解析以太网、IP、TCP、UDP、ARP、DNS，也不管理连接和重传。
   网络栈属于 Obr 驱动。 */

mod base64;
mod sha1;
mod wire;
mod ws;

use std::env;
use std::io;
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

use wire::Wire;

const DEFAULT_ADDR: &str = "127.0.0.1:8766";
const PATH: &str = "/nic";
const FRAME_MAX: usize = 262_144;
const QUEUE_DEPTH: usize = 256;

const OP_INFO: u8 = 0;
const OP_SEND: u8 = 1;
const OP_RECV: u8 = 2;
const OP_CONFIG: u8 = 3;
const OP_PING: u8 = 4;

const STATUS_OK: u8 = 0;
const STATUS_EMPTY: u8 = 1;
const STATUS_BAD_OP: u8 = 3;
const STATUS_TOO_LONG: u8 = 4;
const STATUS_IO: u8 = 5;
const STATUS_BAD_ARG: u8 = 7;

struct Options {
    addr: String,
    wire: String,
}

fn parse_args() -> Options {
    let mut options = Options {
        addr: DEFAULT_ADDR.to_string(),
        wire: "loopback".to_string(),
    };
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--addr" => {
                if let Some(value) = args.next() {
                    options.addr = value;
                }
            }
            "--wire" => {
                if let Some(value) = args.next() {
                    options.wire = value;
                }
            }
            "--help" | "-h" => {
                println!("zeros-nic [--addr 127.0.0.1:8766] [--wire loopback|udp:HOST:PORT]");
                std::process::exit(0);
            }
            _ => {
                eprintln!("unknown argument: {arg}");
                std::process::exit(2);
            }
        }
    }
    options
}

fn status_reply(status: u8) -> Vec<u8> {
    vec![status]
}

fn info_reply(wire: &Wire) -> Vec<u8> {
    let mut reply = vec![STATUS_OK];
    reply.extend_from_slice(&(FRAME_MAX as u32).to_le_bytes());
    reply.extend_from_slice(&(QUEUE_DEPTH as u16).to_le_bytes());
    reply.push(wire.kind());
    reply
}

fn process(wire: &mut Wire, message: &[u8]) -> Vec<u8> {
    let Some((&op, payload)) = message.split_first() else {
        return status_reply(STATUS_BAD_ARG);
    };
    match op {
        OP_INFO => info_reply(wire),
        OP_SEND => {
            if payload.len() > FRAME_MAX {
                return status_reply(STATUS_TOO_LONG);
            }
            match wire.send(payload) {
                Ok(()) => status_reply(STATUS_OK),
                Err(_) => status_reply(STATUS_IO),
            }
        }
        OP_RECV => match wire.recv() {
            Ok(Some(frame)) if frame.len() <= FRAME_MAX => {
                let mut reply = vec![STATUS_OK];
                reply.extend_from_slice(&frame);
                reply
            }
            Ok(Some(_)) => status_reply(STATUS_TOO_LONG),
            Ok(None) => status_reply(STATUS_EMPTY),
            Err(_) => status_reply(STATUS_IO),
        },
        OP_CONFIG => {
            let Ok(text) = std::str::from_utf8(payload) else {
                return status_reply(STATUS_BAD_ARG);
            };
            match wire.configure(text) {
                Ok(()) => status_reply(STATUS_OK),
                Err(_) => status_reply(STATUS_BAD_ARG),
            }
        }
        OP_PING => status_reply(STATUS_OK),
        _ => status_reply(STATUS_BAD_OP),
    }
}

fn handle_client(mut stream: TcpStream, gate: Arc<Mutex<()>>, initial_wire: String) -> io::Result<()> {
    let _guard = match gate.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            ws::write_http_error(&mut stream, "503 Service Unavailable")?;
            return Ok(());
        }
    };
    let request = match ws::read_request(&mut stream) {
        Ok(request) => request,
        Err(_) => {
            ws::write_http_error(&mut stream, "400 Bad Request")?;
            return Ok(());
        }
    };
    if request.path != PATH {
        ws::write_http_error(&mut stream, "404 Not Found")?;
        return Ok(());
    }
    ws::write_handshake(&mut stream, &request.key)?;
    let mut wire = Wire::loopback();
    if wire.configure(&initial_wire).is_err() {
        return Ok(());
    }
    loop {
        let frame = match ws::read_frame(&mut stream) {
            Ok(Some(frame)) => frame,
            Ok(None) => break,
            Err(_) => break,
        };
        match frame {
            ws::Frame::Binary(message) | ws::Frame::Text(message) => {
                let reply = process(&mut wire, &message);
                if ws::write_binary(&mut stream, &reply).is_err() {
                    break;
                }
            }
            ws::Frame::Ping(payload) => {
                if ws::write_pong(&mut stream, &payload).is_err() {
                    break;
                }
            }
            ws::Frame::Pong => {}
            ws::Frame::Close => {
                let _ = ws::write_close(&mut stream);
                break;
            }
        }
    }
    Ok(())
}

fn main() {
    let options = parse_args();
    let mut startup_wire = Wire::loopback();
    if let Err(error) = startup_wire.configure(&options.wire) {
        eprintln!("wire: {error}");
        std::process::exit(2);
    }
    let listener = match TcpListener::bind(&options.addr) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("listen {0}: {1}", options.addr, error);
            std::process::exit(1);
        }
    };
    println!("ZNC1 NIC ws://{0}{1}", options.addr, PATH);
    println!("wire {0}", options.wire);
    let gate = Arc::new(Mutex::new(()));
    for incoming in listener.incoming() {
        let stream = match incoming {
            Ok(stream) => stream,
            Err(_) => continue,
        };
        let gate = Arc::clone(&gate);
        let initial_wire = options.wire.clone();
        std::thread::spawn(move || {
            let _ = handle_client(stream, gate, initial_wire);
        });
    }
}
