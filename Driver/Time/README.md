# Time driver

`time.obr` is compiled into `/lib/time.zdll`; `time.mr` is its guest-facing interface.
The driver exposes Unix-epoch milliseconds, setting the wall clock, Gregorian UTC
conversion, and IANA zone conversion from the locally installed TZif database. TZif
POSIX footers are used for recurring daylight-saving rules after the last stored
transition. The `date` command uses the `TZ` environment variable for an IANA zone name
and defaults to UTC.

The motherboard owns only the raw clock chip. Reads use service 30; setting uses
privileged service 50 and therefore requires effective UID 0. A changed value lasts for
the current runtime only. The offline database is provisioned at
`/usr/share/zoneinfo`; its release and license are recorded in
`ZerOS-PRO/Resource/TimeZone/README.md`.

The ABI is a signed 64-bit millisecond value, matching Obr `long` and current VFS inode
timestamps. The chip adds no narrower range limit. Calendar conversion uses quotient and
remainder arithmetic so the signed-64 millisecond endpoints do not overflow while
splitting into days and time-of-day.
