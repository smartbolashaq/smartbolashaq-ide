#!/usr/bin/env bash
# wifi-report.sh — снимок состояния Wi-Fi адаптеров и питания малинки.
# Ничего не меняет, только читает и складывает всё в один файл.
#
#     sudo bash wifi-report.sh            # снимок «как есть»
#     sudo bash wifi-report.sh живые      # с пометкой, чтобы потом различать
#
# Смысл: снять снимок СЕЙЧАС, пока адаптеры работают, и второй — когда
# какой-нибудь снова «умрёт». Разница двух файлов и есть ответ.
# Файл: /home/sultan/wifi-report-<метка>-<дата>.txt
LABEL="${1:-snapshot}"
# кладём файл в домашнюю папку того, кто запустил sudo, а не root
OWNER="${SUDO_USER:-$USER}"
HOMEDIR=$(getent passwd "$OWNER" 2>/dev/null | cut -d: -f6)
[ -d "${HOMEDIR:-}" ] || HOMEDIR="$PWD"
[ -w "$HOMEDIR" ] || HOMEDIR=/tmp
OUT="${HOMEDIR}/wifi-report-${LABEL}-$(date +%F_%H%M).txt"
exec > >(tee "$OUT") 2>&1

h() { printf '\n══════ %s ══════\n' "$1"; }

h "МЕТКА И ВРЕМЯ"
echo "метка: ${LABEL}"; date

h "СИСТЕМА"
uname -a
tr -d '\0' < /proc/device-tree/model 2>/dev/null; echo
grep PRETTY /etc/os-release
echo "ядро сейчас: $(uname -r)"
echo "ядра на диске: $(ls /lib/modules | tr '\n' ' ')"

h "ПИТАНИЕ (было ли проседание напряжения)"
# 0x0 — всё хорошо. Биты 0/16 — просадка сейчас/была с момента загрузки.
if command -v vcgencmd >/dev/null; then
  T=$(vcgencmd get_throttled)
  echo "$T"
  case "$T" in
    *0x0) echo "  → просадок не было";;
    *)    echo "  → БЫЛА просадка питания (бит 0x1 — сейчас, 0x10000 — была раньше)";;
  esac
fi
dmesg | grep -iE 'under-voltage|over-?current|voltage normalised' | tail -10 || echo "  (в dmesg чисто)"

h "USB-УСТРОЙСТВА"
lsusb
echo
lsusb -t

h "WI-FI ИНТЕРФЕЙСЫ (имя · драйвер · шина · MAC)"
for iface in $(ls /sys/class/net); do
  case "$iface" in wl*) ;; *) continue;; esac
  dev=$(readlink -f "/sys/class/net/${iface}/device" 2>/dev/null)
  drv=$(basename "$(readlink -f "/sys/class/net/${iface}/device/driver" 2>/dev/null)" 2>/dev/null)
  case "$dev" in *[/-]usb*) bus=USB;; *mmc*|*sdio*) bus=SDIO-встроенный;; *) bus=?;; esac
  printf '%-14s %-12s %-16s %s\n' "$iface" "${drv:-НЕТ ДРАЙВЕРА}" "$bus" "$(cat /sys/class/net/$iface/address 2>/dev/null)"
  echo "   путь: $dev"
  iw dev "$iface" info 2>/dev/null | sed 's/^/   /'
done
echo
echo "— если тут пусто или нет ни одного USB-интерфейса, а в lsusb устройство есть,"
echo "  значит адаптер виден, но драйвер к нему не прицепился."

h "ЗАГРУЖЕННЫЕ МОДУЛИ"
lsmod | grep -Ei 'rtl|rtw|88|cfg80211|mac80211' || echo "(ни одного модуля Realtek не загружено)"
echo
for m in $(lsmod | awk '/rtl|rtw|88/{print $1}'); do
  echo "--- $m"
  modinfo "$m" 2>/dev/null | grep -E 'filename|version|vermagic|srcversion' | sed 's/^/   /'
done

h "МОДУЛИ НА ДИСКЕ ПОД ТЕКУЩЕЕ ЯДРО"
find /lib/modules/$(uname -r) -iname '*88*' -o -iname '*rtl*' -o -iname '*rtw*' 2>/dev/null | head -20 || true

h "DKMS (пересобираются ли драйверы при обновлении ядра)"
if command -v dkms >/dev/null; then
  dkms status
  echo "— если пусто, драйверы собраны вручную и при обновлении ядра отвалятся."
else
  echo "dkms не установлен — драйверы собраны вручную и при обновлении ядра отвалятся."
fi

h "ПАКЕТЫ ДРАЙВЕРОВ"
dpkg -l 2>/dev/null | grep -iE 'dkms|realtek|8812|88x2|8821|firmware-realtek' | awk '{print $2, $3}' || echo "(нет)"

h "ИСТОРИЯ ОБНОВЛЕНИЙ ЯДРА (сверить с датой, когда адаптеры умерли)"
zgrep -h -A3 -iE 'linux-image|raspberrypi-kernel|linux-headers' /var/log/apt/history.log* 2>/dev/null \
  | grep -iE 'Start-Date|linux-image|raspberrypi-kernel' | tail -30 || echo "(записей нет)"

h "RFKILL"
rfkill list 2>/dev/null || echo "(rfkill недоступен)"

h "USB-АВТОСОН (может усыплять адаптер насмерть)"
echo "usbcore.autosuspend = $(cat /sys/module/usbcore/parameters/autosuspend 2>/dev/null)"
echo "  (-1 = автосон выключен; 2 = засыпает через 2 сек простоя)"
for p in /sys/bus/usb/devices/*/power/control; do
  d=$(dirname "$(dirname "$p")")
  id=$(cat "$d/idVendor" 2>/dev/null):$(cat "$d/idProduct" 2>/dev/null)
  [ "$id" = ":" ] && continue
  printf '  %-12s %s  %s\n' "$(basename "$d")" "$id" "$(cat "$p")"
done

h "NETWORKMANAGER"
nmcli dev status 2>/dev/null
echo
nmcli -f NAME,TYPE,DEVICE,AUTOCONNECT con show 2>/dev/null

h "DMESG: USB И WI-FI (последние 60 строк)"
dmesg | grep -iE 'usb|wlan|wlx|\b8812|\b88x2|\b8821|rtw_|rtl8|firmware|cfg80211' | tail -60

h "КОНЕЦ"
echo "Файл сохранён: ${OUT}"
# отдать файл обычному пользователю, чтобы его можно было открыть и переслать
chown "${OWNER}" "$OUT" 2>/dev/null || true
