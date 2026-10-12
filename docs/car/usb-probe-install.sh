#!/usr/bin/env bash
# usb-probe-install.sh — ставит на малинку автоматический сбор отчёта об
# USB Wi-Fi адаптере ПРИ КАЖДОЙ ЗАГРУЗКЕ, без SSH и без монитора.
#
# Зачем: у Zero 2 W один USB-порт. Воткнул адаптер для проверки — потерял
# и точку доступа, и SSH. Поэтому отчёт пишется прямо на загрузочный раздел
# /boot/firmware — тот самый «bootfs», который виден в Windows как обычный
# диск (там же лежит car_id.txt). Вынул карту, вставил в комп, прочитал.
#
# Ставится ОДИН раз, пока связь есть (с рабочим BU-адаптером):
#     sudo bash usb-probe-install.sh
#
# Дальше на каждой загрузке: три среза состояния — через 45 с, 2,5 мин и
# 5,5 мин после старта. Три, чтобы поймать «поднялся и уснул»: если между
# срезами адаптер пропал или сменил состояние, это будет видно.
# Когда всё снято, зелёный светодиод малинки часто моргает ~6 секунд —
# значит можно выключать питание.
#
# Выключить потом:  sudo systemctl disable car-usb-probe
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '     \033[32m·\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Нужен root: sudo bash $0"

# куда писать: загрузочный раздел, видимый из Windows
OUTDIR=""
for d in /boot/firmware /boot; do [ -d "$d" ] && { OUTDIR="$d"; break; }; done
[ -n "$OUTDIR" ] || die "Не нашёл загрузочный раздел (/boot/firmware или /boot)."
touch "$OUTDIR/.probe-write-test" 2>/dev/null || die "$OUTDIR только для чтения — перемонтируй: sudo mount -o remount,rw $OUTDIR"
rm -f "$OUTDIR/.probe-write-test"

say "1/3  Пишу сборщик отчётов"
cat >/usr/local/sbin/car-usb-probe <<PROBE
#!/usr/bin/env bash
# Снимает три среза состояния USB Wi-Fi и кладёт файл на загрузочный раздел.
OUTDIR="${OUTDIR}"
PROBE
cat >>/usr/local/sbin/car-usb-probe <<'PROBE'
# имя файла без даты: у Zero нет часов, при старте без сети время может врать.
# Поэтому просто следующий свободный номер.
n=1
while [ -e "$(printf '%s/usb-probe-%02d.txt' "$OUTDIR" "$n")" ]; do n=$((n+1)); [ "$n" -gt 99 ] && break; done
OUT=$(printf '%s/usb-probe-%02d.txt' "$OUTDIR" "$n")

printf '\xEF\xBB\xBF' > "$OUT"          # BOM — чтобы блокнот Windows не портил кириллицу
exec >> "$OUT" 2>&1

h() { printf '\n══════ %s ══════\n' "$*"; }

snapshot() {
  h "СРЕЗ $1 — через $2 после загрузки (аптайм: $(cut -d. -f1 /proc/uptime) c)"

  echo "--- USB-устройства"
  lsusb 2>/dev/null || echo "(lsusb недоступен)"

  echo
  echo "--- Wi-Fi интерфейсы (имя · драйвер · шина)"
  found=0
  for iface in $(ls /sys/class/net 2>/dev/null); do
    case "$iface" in wl*) ;; *) continue;; esac
    found=1
    dev=$(readlink -f "/sys/class/net/${iface}/device" 2>/dev/null)
    drv=$(basename "$(readlink -f "/sys/class/net/${iface}/device/driver" 2>/dev/null)" 2>/dev/null)
    case "$dev" in *[/-]usb*) bus=USB;; *mmc*|*sdio*) bus=SDIO;; *) bus='?';; esac
    printf '%-14s %-14s %s\n' "$iface" "${drv:-НЕТ ДРАЙВЕРА}" "$bus"
    iw dev "$iface" info 2>/dev/null | sed 's/^/   /'
  done
  if [ "$found" != 1 ]; then
    echo "НИ ОДНОГО Wi-Fi ИНТЕРФЕЙСА НЕТ"
    echo "   → если выше в lsusb устройство ЕСТЬ, значит драйвер к нему не прицепился"
    echo "   → если в lsusb его тоже НЕТ, значит до малинки не доходит даже питание (порт/переходник)"
  fi

  echo
  echo "--- Умеет ли адаптер режим точки доступа"
  modes=$(iw phy 2>/dev/null | grep -A14 'Supported interface modes' | head -20)
  if [ -n "$modes" ]; then
    echo "$modes"
    case "$modes" in *AP*) echo "   → режим AP поддерживается";; *) echo "   → режима AP В СПИСКЕ НЕТ — точку этот драйвер поднять не сможет";; esac
  else
    echo "(пусто — радио не поднялось, спрашивать не у кого)"
  fi

  echo
  echo "--- Модули Realtek"
  lsmod 2>/dev/null | grep -Ei 'rtl|rtw|88x|88X' || echo "(ни одного не загружено)"

  echo
  echo "--- Питание: просадки напряжения"
  if command -v vcgencmd >/dev/null; then
    T=$(vcgencmd get_throttled 2>/dev/null)
    echo "$T"
    case "$T" in
      *0x0) echo "   → просадок не было";;
      *)    echo "   → БЫЛА просадка! (0x1 — прямо сейчас, 0x10000 — была за эту загрузку)";;
    esac
  fi

  echo
  echo "--- USB-автосон"
  echo "usbcore.autosuspend = $(cat /sys/module/usbcore/parameters/autosuspend 2>/dev/null)"
  for p in /sys/bus/usb/devices/*/power/control; do
    d=$(dirname "$(dirname "$p")")
    id=$(cat "$d/idVendor" 2>/dev/null):$(cat "$d/idProduct" 2>/dev/null)
    [ "$id" = ":" ] && continue
    printf '   %-10s %-12s %s\n' "$(basename "$d")" "$id" "$(cat "$p" 2>/dev/null)"
  done

  echo
  echo "--- NetworkManager"
  nmcli dev status 2>/dev/null || echo "(nmcli недоступен)"

  echo
  echo "--- rfkill"
  rfkill list 2>/dev/null | head -20

  sync                                   # на FAT пишем сразу: питание могут выдернуть
}

h "ОТЧЁТ ОБ USB WI-FI АДАПТЕРЕ"
echo "малинка: $(cat /proc/device-tree/model 2>/dev/null | tr -d '\0')"
echo "имя хоста: $(hostname)"
echo "ядро: $(uname -r)"
echo "время (может врать без сети): $(date)"
echo
echo "КОРОТКО — что воткнуто:"
lsusb 2>/dev/null | grep -viE 'root hub' | sed 's/^/   /' || true
sync

snapshot 1 "45 секунд";  sleep 105
snapshot 2 "2,5 минуты"; sleep 180
snapshot 3 "5,5 минуты"

h "DMESG: всё про USB и Wi-Fi за эту загрузку"
dmesg 2>/dev/null | grep -iE 'usb|wlan|wlx|\b8812|\b88x2|\b8821|rtw|rtl8|firmware|cfg80211|power|current' | tail -120

h "КОНЕЦ"
echo "Файл: $OUT"
sync

# мигнуть светодиодом: отчёт готов, можно выключать питание
LED=""
for l in /sys/class/leds/ACT /sys/class/leds/led0 /sys/class/leds/PWR; do [ -d "$l" ] && { LED="$l"; break; }; done
if [ -n "$LED" ] && [ -w "$LED/trigger" ]; then
  OLD=$(sed -n 's/.*\[\(.*\)\].*/\1/p' "$LED/trigger" 2>/dev/null)
  echo none > "$LED/trigger" 2>/dev/null || true
  for i in $(seq 1 20); do
    echo 1 > "$LED/brightness" 2>/dev/null; sleep 0.15
    echo 0 > "$LED/brightness" 2>/dev/null; sleep 0.15
  done
  echo "${OLD:-mmc0}" > "$LED/trigger" 2>/dev/null || true
fi
PROBE
chmod 755 /usr/local/sbin/car-usb-probe
ok "/usr/local/sbin/car-usb-probe"

say "2/3  Пишу сервис автозапуска"
cat >/etc/systemd/system/car-usb-probe.service <<'UNIT'
[Unit]
Description=Отчёт об USB Wi-Fi адаптере на загрузочный раздел
After=multi-user.target NetworkManager.service

[Service]
Type=simple
ExecStart=/usr/local/sbin/car-usb-probe
Nice=10

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable car-usb-probe.service >/dev/null
ok "car-usb-probe.service включён"

say "3/3  Готово"
cat <<EOF
Что делать дальше:

  1. Выключи малинку:            sudo poweroff
  2. Поменяй BU на AU-адаптер.
  3. Включи питание и подожди ~6 минут.
     Когда зелёный светодиод часто-часто заморгает ~6 секунд — отчёт готов.
  4. Выключи питание, вынь карту, вставь в комп.
     В Windows откроется диск «bootfs» — там файл usb-probe-01.txt
     (при следующих запусках 02, 03 и так далее, старые не затираются).
  5. Скинь мне этот файл.

Проверить прямо сейчас, не меняя адаптер:  sudo systemctl start car-usb-probe
(через 6 минут появится ${OUTDIR}/usb-probe-01.txt с текущим BU)

Выключить сбор потом:  sudo systemctl disable car-usb-probe
EOF
