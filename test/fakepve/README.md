Stand-ins for Proxmox commands (`pct`, `pveam`, `pvesh`, `pvesm`) plus `systemctl`, `apt-get`, `getent`, `hostname`,
so `mare.sh` can be exercised on a normal Linux box. The "container" is the machine itself: files land in
/var/www/mare and /etc/caddy, and Caddy is started by the fake `systemctl` (put a `caddy` binary on PATH).
Only for testing; run as root in a throwaway environment.

    PATH=$PWD/test/fakepve:$PATH bash mare.sh
