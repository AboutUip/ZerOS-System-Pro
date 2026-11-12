/* 网卡的"线"。只搬原始以太网帧，不解析任何协议。
   loopback 把发出的帧放回接收队列，自检用。
   udp 把一帧放进一个 UDP 数据报，是零依赖的虚拟以太网段。 */

use std::collections::VecDeque;
use std::io;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};

const QUEUE_MAX: usize = 256;
const UDP_READ_MAX: usize = 64;
const UDP_DATAGRAM_MAX: usize = 65535;

pub enum Wire {
    Loopback {
        queue: VecDeque<Vec<u8>>,
    },
    Udp {
        socket: UdpSocket,
        peer: SocketAddr,
        queue: VecDeque<Vec<u8>>,
    },
}

impl Wire {
    pub fn loopback() -> Self {
        Self::Loopback {
            queue: VecDeque::new(),
        }
    }

    pub fn configure(&mut self, text: &str) -> Result<(), String> {
        let trimmed = text.trim();
        let lower = trimmed.to_ascii_lowercase();
        if lower == "loopback" || lower == "lo" {
            *self = Self::loopback();
            return Ok(());
        }
        let address_text = if let Some(rest) = lower.strip_prefix("udp:") {
            rest
        } else if let Some(rest) = lower.strip_prefix("udp=") {
            rest
        } else {
            lower.as_str()
        };
        if address_text.is_empty() {
            return Err("udp peer is missing".to_string());
        }
        let mut chosen = None;
        for address in address_text
            .to_socket_addrs()
            .map_err(|error| format!("udp peer is invalid: {error}"))?
        {
            chosen = Some(address);
            break;
        }
        let Some(peer) = chosen else {
            return Err("udp peer has no address".to_string());
        };
        let local = if peer.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };
        let socket = UdpSocket::bind(local).map_err(|error| format!("udp bind failed: {error}"))?;
        socket
            .set_nonblocking(true)
            .map_err(|error| format!("udp nonblocking failed: {error}"))?;
        *self = Self::Udp {
            socket,
            peer,
            queue: VecDeque::new(),
        };
        Ok(())
    }

    pub fn send(&mut self, frame: &[u8]) -> io::Result<()> {
        match self {
            Self::Loopback { queue } => {
                if queue.len() >= QUEUE_MAX {
                    queue.pop_front();
                }
                queue.push_back(frame.to_vec());
                Ok(())
            }
            Self::Udp { socket, peer, .. } => {
                socket.send_to(frame, *peer)?;
                Ok(())
            }
        }
    }

    pub fn recv(&mut self) -> io::Result<Option<Vec<u8>>> {
        match self {
            Self::Loopback { queue } => Ok(queue.pop_front()),
            Self::Udp { socket, queue, .. } => {
                let mut buffer = vec![0u8; UDP_DATAGRAM_MAX];
                for _ in 0..UDP_READ_MAX {
                    match socket.recv_from(&mut buffer) {
                        Ok((size, _)) => {
                            if queue.len() >= QUEUE_MAX {
                                queue.pop_front();
                            }
                            queue.push_back(buffer[..size].to_vec());
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                        Err(error) => return Err(error),
                    }
                }
                Ok(queue.pop_front())
            }
        }
    }

    pub fn kind(&self) -> u8 {
        match self {
            Self::Loopback { .. } => 0,
            Self::Udp { .. } => 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Wire;

    #[test]
    fn loopback_returns_the_same_frame() {
        let mut wire = Wire::loopback();
        wire.send(b"frame-one").unwrap();
        assert_eq!(wire.recv().unwrap().unwrap(), b"frame-one");
        assert!(wire.recv().unwrap().is_none());
    }

    #[test]
    fn configure_switches_to_udp() {
        let mut wire = Wire::loopback();
        wire.configure("udp:127.0.0.1:9").unwrap();
        assert_eq!(wire.kind(), 1);
        wire.configure("loopback").unwrap();
        assert_eq!(wire.kind(), 0);
    }
}
