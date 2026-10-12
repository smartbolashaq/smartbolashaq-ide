#!/usr/bin/env bash
# ap-try.sh — выясняет, ПОЧЕМУ не поднимается точка доступа на этом адаптере.
#
# Три попытки подряд, каждая с полным протоколом ошибки:
#   1. как есть                     — воспроизводим то, что делает main.py
#   2. после `iw reg set KZ`        — проверяем версию «виноват регуляторный домен»
#   3. принудительно на 2.4 ГГц     — проверяем версию «виноват диапазон 5 ГГц»
#
# После всех попыток профиль возвращается в исходное состояние, а машинка —
# в домашнюю сеть, чтобы к ней снова можно было подключиться по SSH.
#
# Запускать ОТЦЕПЛЕННО от SSH (сессия оборвётся на первой же попытке):
#     sudo systemd-run --unit=ap-try --collect bash /home/sultan/ap-try.sh
#
# Результат: /boot/firmware/ap-try-NN.txt  (виден из Windows на диске bootfs)
CON="CarHotspot"
HOME_NET="ALTEL 5G_636F_5G"      # куда вернуться, чтобы снова пустить SSH

OUTDIR=/boot/firmware; [ -d "$OUTDIR" ] || OUTDIR=/boot
n=1; while [ -e "$(printf '%s/ap-try-%02d.txt' "$OUTDIR" "$n")" ]; do n=$((n+1)); [ "$n" -gt 99 ] && break; done
OUT=$(printf '%s/ap-try-%02d.txt' "$OUTDIR" "$n")
printf '\xEF\xBB\xBF' > "$OUT"
exec >> "$OUT" 2>&1

h() { printf '\n══════ %s ══════\n' "$*"; sync; }

h "ЧТО ПРОВЕРЯЕМ"
echo "малинка: $(cat /proc/device-tree/model 2>/dev/null | tr -d '\0')  ($(hostname))"
echo "адаптер: $(lsusb | grep -viE 'root hub' | head -1)"
echo "драйвер: $(basename "$(readlink -f /sys/class/net/wlan0/device/driver 2>/dev/null)" 2>/dev/null)"

h "ИСХОДНОЕ СОСТОЯНИЕ"
echo "--- регуляторный домен (country 00 = мировой: на 5 ГГц точку поднять НЕЛЬЗЯ)"
iw reg get 2>/dev/null | head -20
echo
echo "--- настройки профиля ${CON}"
nmcli -f 802-11-wireless.ssid,802-11-wireless.band,802-11-wireless.channel,802-11-wireless.mode,connection.interface-name,connection.autoconnect con show "$CON" 2>/dev/null

# запоминаем, чтобы потом вернуть как было
OLD_BAND=$(nmcli -g 802-11-wireless.band con show "$CON" 2>/dev/null)
OLD_CHAN=$(nmcli -g 802-11-wireless.channel con show "$CON" 2>/dev/null)

try_ap() {
  h "ПОПЫТКА $1 — $2"
  nmcli con down "$CON" >/dev/null 2>&1
  sleep 2
  echo "--- команда: nmcli con up ${CON}"
  out=$(nmcli con up "$CON" 2>&1); rc=$?
  echo "$out"
  echo "код возврата: $rc"
  sleep 6
  echo
  echo "--- что получилось"
  iw dev 2>/dev/null | grep -E 'Interface|type|channel|ssid|txpower' | sed 's/^/   /'
  nmcli -f DEVICE,STATE,CONNECTION dev status 2>/dev/null | sed 's/^/   /'
  if iw dev 2>/dev/null | grep -q 'type AP'; then
    echo "   ✅ ТОЧКА ПОДНЯЛАСЬ"
  else
    echo "   ❌ точка НЕ поднялась"
  fi
  echo
  echo "--- что сказал NetworkManager"
  journalctl -u NetworkManager -n 25 --no-pager 2>/dev/null | sed 's/^/   /'
  echo
  echo "--- что сказало ядро"
  dmesg 2>/dev/null | tail -15 | sed 's/^/   /'
  nmcli con down "$CON" >/dev/null 2>&1
  sync
}

# ─── 1. как есть — ровно то, что делает main.py ───────────────────────────
try_ap 1 "как есть, ничего не меняя"

# ─── 2. со страной ────────────────────────────────────────────────────────
h "СТАВЛЮ СТРАНУ KZ"
iw reg set KZ 2>&1
sleep 3
iw reg get 2>/dev/null | head -12
try_ap 2 "после iw reg set KZ"

# ─── 3. принудительно 2.4 ГГц ─────────────────────────────────────────────
h "ПЕРЕВОЖУ ПРОФИЛЬ НА 2.4 ГГц (временно)"
nmcli con modify "$CON" 802-11-wireless.band bg 802-11-wireless.channel 6 2>&1
try_ap 3 "на 2.4 ГГц, канал 6"

h "ВОЗВРАЩАЮ ПРОФИЛЬ КАК БЫЛО"
nmcli con modify "$CON" 802-11-wireless.band "${OLD_BAND:-a}" 2>&1
if [ -n "$OLD_CHAN" ] && [ "$OLD_CHAN" != "0" ]; then nmcli con modify "$CON" 802-11-wireless.channel "$OLD_CHAN" 2>&1; fi
nmcli -f 802-11-wireless.band,802-11-wireless.channel con show "$CON" 2>/dev/null

h "ВОЗВРАЩАЮ МАЛИНКУ В ДОМАШНЮЮ СЕТЬ (чтобы пустила по SSH)"
nmcli con up "$HOME_NET" 2>&1 | tail -2
sleep 8
nmcli -f DEVICE,STATE,CONNECTION dev status 2>/dev/null

h "ИТОГ"
echo "Файл: $OUT"
echo "Читать так: у какой попытки написано «ТОЧКА ПОДНЯЛАСЬ» — та настройка и рабочая."
echo "Если поднялась только во 2-й — виноват регуляторный домен, лечится заданием страны."
echo "Если только в 3-й — виноват диапазон 5 ГГц у этого драйвера."
echo "Если ни в одной — смотрим текст ошибки NetworkManager выше."
sync
