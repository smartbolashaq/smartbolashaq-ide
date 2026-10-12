#!/usr/bin/env bash
# usb-retry-install.sh — ставит на малинку сервис, который при загрузке
# ПОВТОРНО пытается опознать USB Wi-Fi адаптер, если он не подхватился сразу.
#
# Зачем: адаптер на Zero 2 W опознаётся не всегда — это лотерея одной секунды
# на старте (бросок тока, контакт, тайминг). Если опознался — дальше работает
# весь сеанс нормально. Значит монетку надо просто подбросить ещё раз.
#
# Что делает сервис на каждой загрузке:
#   1. ждёт до 10 секунд появления Wi-Fi интерфейса;
#   2. если его нет — смотрит, ВИДЕН ли адаптер как USB-устройство, и выбирает
#      лечение: не виден вовсе → сброс шины; виден, но без интерфейса →
#      перезагрузка драйвера;
#   3. если не помогло — сброс самого USB-контроллера;
#   4. всего до 4 попыток, потом сдаётся и подробно записывает, что видел.
#
# Сервис запускается ПЕРЕД NetworkManager, поэтому NM стартует уже с готовым
# адаптером и сразу поднимает точку доступа.
#
# Куда пишет: на загрузочный раздел /boot/firmware — тот самый «bootfs»,
# который виден из Windows как обычный диск (там же лежит car_id.txt).
#   usb-retry-СВОДКА.txt  — одна строка на загрузку, это главное что читать
#   usb-retry.log         — подробности по каждой неудачной попытке
#
# Ставится один раз, пока связь есть (с рабочим адаптером):
#     sudo bash usb-retry-install.sh
#
# Выключить потом:  sudo systemctl disable car-usb-retry
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '     \033[32m·\033[0m %s\n' "$*"; }
warn() { printf '     \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Нужен root: sudo bash $0"

# ── куда писать отчёты: загрузочный раздел, видимый из Windows ───────────────
OUTDIR=""
for d in /boot/firmware /boot; do [ -d "$d" ] && { OUTDIR="$d"; break; }; done
[ -n "$OUTDIR" ] || die "Не нашёл загрузочный раздел (/boot/firmware или /boot)."
if ! touch "$OUTDIR/.retry-write-test" 2>/dev/null; then
  warn "$OUTDIR только для чтения — отчёты уйдут в /var/log"
  OUTDIR=/var/log
else
  rm -f "$OUTDIR/.retry-write-test"
fi
ok "отчёты: $OUTDIR"

# ── проверяем, какие способы сброса доступны на этой плате ──────────────────
if [ -w /sys/bus/usb/drivers/usb/unbind ]; then
  ok "сброс шины доступен"
else
  warn "нет /sys/bus/usb/drivers/usb/unbind — сброс шины будет пропускаться"
fi
CTRL_FOUND=0
for drv in /sys/bus/platform/drivers/dwc2 /sys/bus/platform/drivers/dwc_otg; do
  [ -d "$drv" ] || continue
  if [ -w "$drv/unbind" ]; then CTRL_FOUND=1; ok "сброс контроллера доступен: $(basename "$drv")"; fi
done
[ "$CTRL_FOUND" = 1 ] || warn "сброс контроллера недоступен — останутся сброс шины и перезагрузка драйвера"

say "1/3  Пишу сам сервис"
cat >/usr/local/sbin/car-usb-retry <<RETRY
#!/usr/bin/env bash
OUTDIR="${OUTDIR}"
RETRY
cat >>/usr/local/sbin/car-usb-retry <<'RETRY'
# car-usb-retry — повторные попытки опознать USB Wi-Fi адаптер при загрузке.
#   без аргументов  — рабочий режим (запускается сервисом при загрузке)
#   --status        — что сейчас видно, ничего не трогая
#   --test [--force] — принудительные сбросы прямо сейчас, для проверки
#
# ВНИМАНИЕ про --test: сбросы рвут связь. Если ты сидишь по SSH через этот
# самый адаптер, сессия оборвётся. Поэтому вывод дублируется в файл на
# загрузочном разделе, и его можно прочитать потом или вынув карту.

LOG="$OUTDIR/usb-retry.log"
SUM="$OUTDIR/usb-retry-СВОДКА.txt"
TST="$OUTDIR/usb-retry-ТЕСТ.txt"
CNT=/var/lib/car-usb-retry.count
MAXLOG=400000

# файлы с BOM, чтобы блокнот Windows не портил кириллицу
init_file() { [ -s "$1" ] || printf '\xEF\xBB\xBF' > "$1" 2>/dev/null || true; }
mkdir -p "$(dirname "$CNT")" 2>/dev/null || true
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt "$MAXLOG" ]; then
  mv -f "$LOG" "$LOG.old" 2>/dev/null || true
fi
init_file "$LOG"; init_file "$SUM"

log() { printf '%s\n' "$*" >> "$LOG"; }
sum() { printf '%s\n' "$*" >> "$SUM"; sync; }

# ── Wi-Fi интерфейс на шине USB ────────────────────────────────────────────
# Встроенное радио на машинках выключено, но шину проверяем честно:
# интересует только внешний адаптер.
usb_wifi() {
  local iface dev drv
  for iface in $(ls /sys/class/net 2>/dev/null); do
    case "$iface" in wl*) ;; *) continue;; esac
    dev=$(readlink -f "/sys/class/net/${iface}/device" 2>/dev/null || true)
    case "$dev" in
      *[/-]usb*)
        drv=$(basename "$(readlink -f "/sys/class/net/${iface}/device/driver" 2>/dev/null)" 2>/dev/null || true)
        printf '%s/%s' "$iface" "${drv:-?}"
        return 0;;
    esac
  done
  return 1
}

# Любое USB-устройство кроме корневых хабов. На машинке оно ровно одно —
# адаптер. Если он ЕСТЬ, а интерфейса нет, значит виноват драйвер,
# а не питание, и лечить надо по-другому.
usb_seen() { [ -n "$(lsusb 2>/dev/null | grep -viE 'root hub')" ]; }
usb_line() { lsusb 2>/dev/null | grep -viE 'root hub' | head -3 | tr '\n' ';' | sed 's/;$//'; }

wait_for() {              # wait_for <секунд> — ждём появления интерфейса
  local n="$1"
  while [ "$n" -gt 0 ]; do
    usb_wifi >/dev/null && return 0
    sleep 1; n=$((n-1))
  done
  return 1
}

# ── лечение 1: сброс шины (корневой хаб отвязать и привязать обратно) ───────
reset_hub() {
  local hubs n
  [ -w /sys/bus/usb/drivers/usb/unbind ] || { log "   (сброс шины недоступен)"; return 1; }
  hubs=$(for h in /sys/bus/usb/devices/usb[0-9]*; do [ -e "$h" ] && basename "$h"; done)
  [ -n "$hubs" ] || { log "   (корневых хабов не видно)"; return 1; }
  log "   отвязываю шину: $hubs"
  for n in $hubs; do echo "$n" > /sys/bus/usb/drivers/usb/unbind 2>/dev/null || true; done
  sleep 3
  for n in $hubs; do echo "$n" > /sys/bus/usb/drivers/usb/bind 2>/dev/null || true; done
  log "   шина привязана обратно"
  return 0
}

# ── лечение 2: перезагрузка драйвера адаптера ──────────────────────────────
# Имеет смысл, когда устройство в lsusb ЕСТЬ, а сетевого интерфейса нет.
reload_drv() {
  local mods m
  mods=$(lsmod 2>/dev/null | awk '/^(rtw88_|rtw_|rtl88|rtl8|88x2|8812|8821|8811)/{print $1}')
  [ -n "$mods" ] || { log "   (модулей Realtek не загружено — перезагружать нечего)"; return 1; }
  log "   перезагружаю модули: $(echo "$mods" | tr '\n' ' ')"
  for m in $mods; do modprobe -r "$m" 2>/dev/null || true; done
  sleep 2
  for m in $mods; do modprobe "$m" 2>/dev/null || true; done
  return 0
}

# ── лечение 3: сброс самого USB-контроллера ────────────────────────────────
reset_ctrl() {
  local drv d name done_any=0
  for drv in /sys/bus/platform/drivers/dwc2 /sys/bus/platform/drivers/dwc_otg; do
    { [ -d "$drv" ] && [ -w "$drv/unbind" ]; } || continue
    for d in "$drv"/*.usb; do
      [ -e "$d" ] || continue
      name=$(basename "$d")
      log "   сбрасываю контроллер $name ($(basename "$drv"))"
      echo "$name" > "$drv/unbind" 2>/dev/null || continue
      sleep 3
      echo "$name" > "$drv/bind" 2>/dev/null || true
      done_any=1
    done
  done
  [ "$done_any" = 1 ] || { log "   (сброс контроллера недоступен)"; return 1; }
  return 0
}

throttled() { command -v vcgencmd >/dev/null && vcgencmd get_throttled 2>/dev/null | cut -d= -f2 || echo '?'; }

# ══ режим --status ═════════════════════════════════════════════════════════
if [ "${1:-}" = "--status" ]; then
  if w=$(usb_wifi); then echo "Wi-Fi адаптер: $w"; else echo "Wi-Fi адаптера НЕТ"; fi
  echo "в lsusb:  $(usb_line)"
  echo "питание:  $(throttled)   (0x0 = просадок не было)"
  echo "сводка:   $SUM"
  exit 0
fi

# ══ режим --test ═══════════════════════════════════════════════════════════
if [ "${1:-}" = "--test" ]; then
  if [ "${2:-}" != "--force" ] && [ -t 0 ]; then
    echo "Сейчас будут сделаны настоящие сбросы USB."
    echo "Если ты подключён по SSH ЧЕРЕЗ этот адаптер — связь оборвётся."
    echo "Результат в любом случае будет записан в: $TST"
    printf 'Продолжить? [y/N] '
    read -r a; case "$a" in y|Y|д|Д) ;; *) echo "отменено"; exit 0;; esac
  fi
  init_file "$TST"
  {
    echo ""
    echo "══════ ТЕСТ $(date '+%Y-%m-%d %H:%M') ══════"
    echo "до сброса:              $(usb_wifi || echo 'интерфейса нет')"
    echo "в lsusb:                $(usb_line)"
  } >> "$TST"; sync
  reset_hub || true;  wait_for 15 || true
  echo "после сброса шины:      $(usb_wifi || echo 'интерфейса нет')" >> "$TST"; sync
  reset_ctrl || true; wait_for 15 || true
  echo "после сброса контроллера: $(usb_wifi || echo 'интерфейса нет')" >> "$TST"
  echo "питание: $(throttled)" >> "$TST"
  echo "ВЫВОД: если интерфейс пережил оба сброса — механизм рабочий." >> "$TST"
  sync
  tail -12 "$TST" 2>/dev/null || true
  exit 0
fi

# ══ рабочий режим ══════════════════════════════════════════════════════════
N=$(( $(cat "$CNT" 2>/dev/null || echo 0) + 1 ))
echo "$N" > "$CNT" 2>/dev/null || true

START=$(cut -d. -f1 /proc/uptime)
STAMP=$(date '+%Y-%m-%d %H:%M' 2>/dev/null)
log ""
log "══════ загрузка #$N · $STAMP · аптайм $START c ══════"
log "плата: $(cat /proc/device-tree/model 2>/dev/null | tr -d '\0')   ядро: $(uname -r)"
log "в lsusb: $(usb_line)"

RESULT=""; ATTEMPT=0

if wait_for 10; then
  RESULT="сразу"
else
  log "интерфейса нет — начинаю попытки"
  for step in 1 2 3 4; do
    ATTEMPT="$step"
    log ""
    log "── попытка $ATTEMPT ──"
    log "   в lsusb сейчас: $(usb_line)"
    if usb_seen; then
      log "   адаптер ВИДЕН по USB, но интерфейса нет → похоже на драйвер"
      case "$step" in
        1) reload_drv || reset_hub  || true;;
        2) reset_hub  || true;;
        3|4) reset_ctrl || reset_hub || true;;
      esac
    else
      log "   адаптера в lsusb НЕТ → до него не доходит даже питание"
      case "$step" in
        1|2) reset_hub  || true;;
        3|4) reset_ctrl || reset_hub || true;;
      esac
    fi
    if wait_for 12; then RESULT="$ATTEMPT"; break; fi
    log "   не помогло"
  done
fi

END=$(cut -d. -f1 /proc/uptime)
TOOK=$((END-START))
THR=$(throttled)

if [ -n "$RESULT" ]; then
  IFACE=$(usb_wifi)
  if [ "$RESULT" = "сразу" ]; then
    sum "$(printf '#%04d  %s  УСПЕХ сразу               %-16s питание=%s' "$N" "$STAMP" "$IFACE" "$THR")"
    log "ИТОГ: адаптер подхватился сам, попытки не понадобились"
  else
    sum "$(printf '#%04d  %s  УСПЕХ с попытки %s (%s c)   %-16s питание=%s' "$N" "$STAMP" "$RESULT" "$TOOK" "$IFACE" "$THR")"
    log "ИТОГ: помогла попытка $RESULT, заняло $TOOK c"
  fi
else
  sum "$(printf '#%04d  %s  ПРОВАЛ после 4 попыток (%s c)  lsusb: %s  питание=%s' "$N" "$STAMP" "$TOOK" "$(usb_line)" "$THR")"
  log "ИТОГ: не удалось. Ниже — что сказало ядро."
  log ""
  dmesg 2>/dev/null \
    | grep -iE 'usb|wlan|wlx|8812|88x2|8821|rtw|rtl8|firmware|under-voltage|over-?current' \
    | tail -60 | sed 's/^/   /' >> "$LOG"
fi
sync
exit 0
RETRY
chmod 755 /usr/local/sbin/car-usb-retry
ok "/usr/local/sbin/car-usb-retry"

say "2/3  Пишу юнит автозапуска"
cat >/etc/systemd/system/car-usb-retry.service <<'UNIT'
[Unit]
Description=Повторные попытки опознать USB Wi-Fi адаптер
# после udev, но ДО NetworkManager: пусть NM стартует уже с готовым
# адаптером и сразу поднимает точку доступа
After=systemd-udevd.service local-fs.target
Before=NetworkManager.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/car-usb-retry
# потолок: 10 с ожидания + 4 попытки примерно по 18 с
TimeoutStartSec=180

[Install]
WantedBy=NetworkManager.service
UNIT
systemctl daemon-reload
systemctl enable car-usb-retry.service >/dev/null
ok "car-usb-retry.service включён"

say "3/3  Готово"
cat <<EOF
Посмотреть состояние, ничего не трогая:
    sudo car-usb-retry --status

Проверить, что сбросы реально работают (СВЯЗЬ ОБОРВЁТСЯ, если ты по SSH
через этот адаптер — результат останется в файле):
    sudo car-usb-retry --test

Дальше ничего делать не надо: сервис отработает сам на каждой загрузке.

Читать результат:  ${OUTDIR}/usb-retry-СВОДКА.txt
    одна строка на загрузку — подхватился сам, с какой попытки, или провал.
    Подробности неудач — в usb-retry.log рядом.
$( [ "$OUTDIR" = /boot/firmware ] || [ "$OUTDIR" = /boot ] && echo "    Оба файла видны из Windows на диске «bootfs»." )

Чтобы машинка ждала адаптер перед стартом своей программы, добавь
в её юнит строку:  After=car-usb-retry.service

Выключить:  sudo systemctl disable car-usb-retry
EOF
