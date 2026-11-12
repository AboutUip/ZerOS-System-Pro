/* 最小的 WebSocket 服务端。只做握手、二进制帧、ping/pong 和 close。
   不解释载荷，也不做分片以外的协议扩展。 */

use std::io::{self, Read, Write};
use std::net::TcpStream;

use crate::base64;
use crate::sha1;

const MAX_HEADER: usize = 8192;
const MAX_MESSAGE: usize = 16 * 1024 * 1024;
const ACCEPT_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

pub struct Request {
    pub path: String,
    pub key: String,
}

pub enum Frame {
    Binary(Vec<u8>),
    Text(Vec<u8>),
    Ping(Vec<u8>),
    Pong,
    Close,
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n").map(|at| at + 4)
}

pub fn read_request(stream: &mut TcpStream) -> io::Result<Request> {
    let mut raw = Vec::new();
    let mut chunk = [0u8; 1024];
    let end;
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "request is incomplete"));
        }
        raw.extend_from_slice(&chunk[..read]);
        if let Some(at) = find_header_end(&raw) {
            end = at;
            break;
        }
        if raw.len() > MAX_HEADER {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "request header is too long"));
        }
    }
    let text = String::from_utf8_lossy(&raw[..end]).into_owned();
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/");
    if method != "GET" {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "request is not GET"));
    }
    let mut key = String::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("sec-websocket-key") {
                key = value.trim().to_string();
            }
        }
    }
    if key.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "sec-websocket-key is missing"));
    }
    Ok(Request {
        path: path.to_string(),
        key,
    })
}

pub fn accept_key(key: &str) -> String {
    let mut input = String::with_capacity(key.len() + ACCEPT_GUID.len());
    input.push_str(key);
    input.push_str(ACCEPT_GUID);
    base64::encode(&sha1::sha1(input.as_bytes()))
}

pub fn write_handshake(stream: &mut TcpStream, key: &str) -> io::Result<()> {
    let accept = accept_key(key);
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

pub fn write_http_error(stream: &mut TcpStream, status: &str) -> io::Result<()> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 5\r\nConnection: close\r\n\r\nbusy\n"
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

fn read_exact(stream: &mut TcpStream, size: usize) -> io::Result<Vec<u8>> {
    let mut buffer = vec![0u8; size];
    stream.read_exact(&mut buffer)?;
    Ok(buffer)
}

fn read_one(stream: &mut TcpStream) -> io::Result<(bool, u8, Vec<u8>)> {
    let head = read_exact(stream, 2)?;
    let first = head[0];
    let second = head[1];
    let fin = (first & 0x80) != 0;
    let reserved = first & 0x70;
    let opcode = first & 0x0f;
    if reserved != 0 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "reserved bits are set"));
    }
    let masked = (second & 0x80) != 0;
    let mut length = (second & 0x7f) as usize;
    if length == 126 {
        let extended = read_exact(stream, 2)?;
        length = u16::from_be_bytes([extended[0], extended[1]]) as usize;
    } else if length == 127 {
        let extended = read_exact(stream, 8)?;
        let mut value = 0u64;
        for byte in extended {
            value = (value << 8) | byte as u64;
        }
        if value > MAX_MESSAGE as u64 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "message is too long"));
        }
        length = value as usize;
    }
    if length > MAX_MESSAGE {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "message is too long"));
    }
    let mask = if masked { Some(read_exact(stream, 4)?) } else { None };
    let mut payload = read_exact(stream, length)?;
    if let Some(mask) = mask {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index & 3];
        }
    }
    Ok((fin, opcode, payload))
}

pub fn read_frame(stream: &mut TcpStream) -> io::Result<Option<Frame>> {
    let mut pending: Option<(u8, Vec<u8>)> = None;
    loop {
        let (fin, opcode, payload) = read_one(stream)?;
        match opcode {
            0x0 => {
                let Some((first, mut data)) = pending.take() else {
                    return Err(io::Error::new(io::ErrorKind::InvalidData, "unexpected continuation"));
                };
                data.extend_from_slice(&payload);
                if data.len() > MAX_MESSAGE {
                    return Err(io::Error::new(io::ErrorKind::InvalidData, "message is too long"));
                }
                if fin {
                    return Ok(Some(match first {
                        0x1 => Frame::Text(data),
                        0x2 => Frame::Binary(data),
                        _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "unknown opcode")),
                    }));
                }
                pending = Some((first, data));
            }
            0x1 | 0x2 => {
                if fin {
                    return Ok(Some(if opcode == 0x1 {
                        Frame::Text(payload)
                    } else {
                        Frame::Binary(payload)
                    }));
                }
                pending = Some((opcode, payload));
            }
            0x8 => return Ok(Some(Frame::Close)),
            0x9 => return Ok(Some(Frame::Ping(payload))),
            0xa => return Ok(Some(Frame::Pong)),
            _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "unknown opcode")),
        }
    }
}

fn write_frame(stream: &mut TcpStream, opcode: u8, payload: &[u8]) -> io::Result<()> {
    let length = payload.len();
    let mut header = Vec::with_capacity(10);
    header.push(0x80 | opcode);
    if length < 126 {
        header.push(length as u8);
    } else if length <= 0xffff {
        header.push(126);
        header.extend_from_slice(&(length as u16).to_be_bytes());
    } else {
        header.push(127);
        header.extend_from_slice(&(length as u64).to_be_bytes());
    }
    stream.write_all(&header)?;
    stream.write_all(payload)?;
    stream.flush()
}

pub fn write_binary(stream: &mut TcpStream, payload: &[u8]) -> io::Result<()> {
    write_frame(stream, 0x2, payload)
}

pub fn write_pong(stream: &mut TcpStream, payload: &[u8]) -> io::Result<()> {
    write_frame(stream, 0xa, payload)
}

pub fn write_close(stream: &mut TcpStream) -> io::Result<()> {
    write_frame(stream, 0x8, &[])
}

#[cfg(test)]
mod tests {
    use super::accept_key;

    #[test]
    fn accept_key_matches_rfc_example() {
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }
}
