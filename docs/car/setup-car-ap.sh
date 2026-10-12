#!/usr/bin/env bash
# setup-car-ap.sh — точка доступа машинки поднимается сама при каждой загрузке.
#
# Ничего не изобретает: работает с ТВОИМ профилем CarHotspot (пароль 12345678),
# с ТВОИМ файлом /boot/firmware/car_id.txt и с ТВОИМ USB-адаптером RTL8812AU.
# main.py менять не нужно — его hotspot_active() увидит, что точка уже в эфире,
# и не станет её перезапускать.
#
# Что делает автозапуск вместо скриптов с задержкой:
#   1. Профиль CarHotspot получает autoconnect=yes и привязку к драйверу
#      USB-адаптера. NetworkManager сам поднимет точку в тот момент, когда
#      адаптер реально появится в системе — хоть на пятой секунде, хоть на
#      тридцатой, хоть когда ты воткнёшь его в уже работающую машинку.
#      Встроенный wlan0 при этом не трогается: домашние сети и SSH как были.
#   2. Сервис car-ap-ssid прописывает SSID из car_id.txt в профиль ДО старта
#      NetworkManager — просто правит файл профиля, пока NM ещё не запущен.
#      Клонировал флешку, поменял число в car_id.txt — сеть уже с новым именем.
#   3. Диспетчер NetworkManager выкручивает мощность передатчика (iw reg set KZ,
#      txpower 2300) сразу после подъёма точки — те же «стероиды», что в main.py,
#      но и при автостарте тоже.
#
# Запуск один раз на эталонной флешке, от root:
#     sudo bash setup-car-ap.sh
#
# ВАЖНО: запускать по USB-кабелю (ssh 10.55.0.1) или с монитором и клавиатурой.
# И USB-адаптер Wi-Fi должен быть воткнут — скрипт читает имя его драйвера.
set -euo pipefail

CON="CarHotspot"          # рабочий профиль, тот самый из КАК_КЛОНИРОВАТЬ.md
REG="${REG:-KZ}"
TXPOWER="${TXPOWER:-2300}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '     \033[32m·\033[0m %s\n' "$*"; }
warn() { printf '     \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ─── 0. проверки ────────────────────────────────────────────────────────────
[ "$(id -u)" = 0 ] || die "Нужен root: sudo bash $0"
command -v nmcli >/dev/null || die "nmcli не найден — это не NetworkManager-система."
systemctl is-active --quiet NetworkManager || die "NetworkManager не запущен: systemctl status NetworkManager"
nmcli -t -f NAME con show | grep -qx "${CON}" || die "Профиль ${CON} не найден. Он должен быть в образе; посмотри nmcli con show."

# ─── 1. ID машинки ──────────────────────────────────────────────────────────
say "1/6  ID машинки"
ID_FILE=""
for f in /boot/firmware/car_id.txt /boot/car_id.txt; do [ -f "$f" ] && { ID_FILE="$f"; break; }; done
[ -n "$ID_FILE" ] || die "Нет car_id.txt ни в /boot/firmware, ни в /boot."
ID=$(tr -cd '[:alnum:]-_' < "$ID_FILE")
[ -n "$ID" ] || die "Файл ${ID_FILE} пустой."
SSID="Car_${ID}_WiFi"
ok "${ID_FILE} → ID ${ID} → сеть ${SSID}"

# ─── 2. внешний Wi-Fi адаптер ───────────────────────────────────────────────
# Ищем НЕ по имени драйвера (их зоопарк: 8812au, 88XXau, 88x2bu, rtw_8822bu…),
# а по шине: внешний адаптер всегда висит на USB, а встроенный у малинки — на
# SDIO. Это не зависит ни от модели адаптера, ни от версии драйвера.
# Привязываемся потом к ДРАЙВЕРУ, а не к имени интерфейса и не к MAC: имя (wlx…)
# и MAC у каждого адаптера свои, а драйвер один и тот же — значит образ можно
# клонировать, и на новой машинке всё заработает без повторной настройки.
say "2/6  Wi-Fi адаптер для точки доступа"
AP_IFACE=""; AP_DRV=""
list_wifi() {
  for iface in $(ls /sys/class/net); do
    case "$iface" in wl*) ;; *) continue;; esac
    local dev drv bus
    dev=$(readlink -f "/sys/class/net/${iface}/device" 2>/dev/null || true)
    drv=$(basename "$(readlink -f "/sys/class/net/${iface}/device/driver" 2>/dev/null)" 2>/dev/null || true)
    case "$dev" in *[/-]usb*) bus=usb;; *mmc*|*sdio*) bus=sdio;; *) bus=other;; esac
    printf '%s\t%s\t%s\n' "$iface" "${drv:-?}" "$bus"
  done
}
while IFS=$'\t' read -r iface drv bus; do
  [ "$bus" = usb ] || continue
  AP_IFACE="$iface"; AP_DRV="$drv"; break
done < <(list_wifi)

if [ -z "$AP_IFACE" ]; then
  printf '\n\033[31mВнешний USB Wi-Fi адаптер не найден.\033[0m\n'
  printf 'Что система видит сейчас (интерфейс · драйвер · шина):\n'
  list_wifi | while IFS=$'\t' read -r i d b; do printf '     · %-12s %-12s %s\n' "$i" "$d" "$b"; done
  printf '\nЕсли адаптер воткнут, но его тут нет — не подхватился драйвер.\n'
  printf 'Покажи вывод: lsusb  и  dmesg | tail -30\n\n'
  exit 1
fi
ok "${AP_IFACE}, драйвер ${AP_DRV}, шина USB"

# ─── 3. профиль: автозапуск + привязка к адаптеру ───────────────────────────
say "3/6  Настраиваю профиль ${CON}"
nmcli con modify "${CON}" 802-11-wireless.ssid "${SSID}"
nmcli con modify "${CON}" connection.autoconnect yes
nmcli con modify "${CON}" connection.autoconnect-priority 100
nmcli con modify "${CON}" connection.autoconnect-retries 0
nmcli con modify "${CON}" 802-11-wireless.powersave 2
ok "autoconnect yes, приоритет 100, повторы без ограничения, сон выключен"
#  autoconnect-retries 0 — бесконечные попытки: адаптер поднялся поздно, NM дожмёт
#  powersave 2           — Zero 2 W в роли точки иначе «засыпает» и рвёт связь с пилотом

# Привязка к драйверу: NM ждёт внешний адаптер и не занимает wlan0.
# В списке — драйверы ОБЕИХ версий адаптера (AU и BU) и их обычные имена, плюс
# тот, что реально найден на этой машинке. Лишние имена не мешают: они просто
# ни с чем не совпадут. Благодаря списку один образ заводится и на AU, и на BU.
#   rtw88_* — штатные драйверы ядра (ими подхватывается AU на этих машинках),
#   остальные — сторонние сборки (BU живёт на rtl88x2bu через DKMS).
DRV_LIST="${AP_DRV},rtw88_8812au,rtw88_8821au,rtw88_8822bu,rtw88_8812bu,rtw88_8821cu,rtw88_8811cu,rtw88_usb"
DRV_LIST="${DRV_LIST},88XXau,8812au,rtl8812au,rtl88xxau,88x2bu,rtl88x2bu,rtl8822bu,rtw_8822bu,8821cu,rtl8821cu"
DRV_LIST=$(printf '%s' "$DRV_LIST" | tr ',' '\n' | awk 'NF && !seen[$0]++' | paste -sd,)
if nmcli con modify "${CON}" match.driver "${DRV_LIST}" 2>/dev/null; then
  nmcli con modify "${CON}" connection.interface-name "" 2>/dev/null || true
  ok "привязка к драйверу: $(nmcli -g match.driver con show "${CON}" 2>/dev/null || echo "${DRV_LIST}")"
  ok "переживает клонирование флешки и смену адаптера AU ↔ BU"
  BIND="driver"
else
  nmcli con modify "${CON}" connection.interface-name "${AP_IFACE}"
  warn "NetworkManager не понимает match.driver — привязал к имени ${AP_IFACE}."
  warn "На клоне с другим адаптером имя может отличаться — тогда запусти скрипт там ещё раз."
  BIND="iface"
fi

# ─── 4. SSID из car_id.txt до старта NetworkManager ─────────────────────────
# Правим файл профиля, пока NM ещё не запущен: никаких гонок, к моменту его
# старта в профиле уже правильное имя сети.
say "4/6  Сервис синхронизации имени сети"
cat >/usr/local/sbin/car-ap-ssid <<'SYNC'
#!/bin/sh
# Прописывает SSID Car_<ID>_WiFi в профиль CarHotspot из car_id.txt.
# Запускается systemd до NetworkManager — правит файл, не дёргает nmcli.
set -eu
CON="CarHotspot"
for f in /boot/firmware/car_id.txt /boot/car_id.txt; do [ -f "$f" ] && { IDF="$f"; break; }; done
[ -n "${IDF:-}" ] || exit 0
ID=$(tr -cd '[:alnum:]-_' < "$IDF")
[ -n "$ID" ] || exit 0
KEY=$(grep -ls "^id=${CON}\$" /etc/NetworkManager/system-connections/*.nmconnection 2>/dev/null | head -1)
[ -n "$KEY" ] || exit 0
WANT="ssid=Car_${ID}_WiFi"
grep -qx "$WANT" "$KEY" && exit 0
sed -i "s/^ssid=.*/${WANT}/" "$KEY"
chmod 600 "$KEY"
logger -t car-ap-ssid "SSID профиля ${CON} → Car_${ID}_WiFi"
SYNC
chmod 755 /usr/local/sbin/car-ap-ssid

cat >/etc/systemd/system/car-ap-ssid.service <<'UNIT'
[Unit]
Description=Имя Wi-Fi точки машинки из car_id.txt
DefaultDependencies=no
After=local-fs.target
Before=NetworkManager.service network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/car-ap-ssid

[Install]
WantedBy=NetworkManager.service
UNIT
systemctl daemon-reload
systemctl enable car-ap-ssid.service >/dev/null
ok "car-ap-ssid.service включён (запускается перед NetworkManager)"

# ─── 5. мощность передатчика после подъёма точки ────────────────────────────
# Диспетчер NetworkManager вызывается ровно в момент, когда соединение поднялось.
# Те же команды, что в main.py, но срабатывают и при автостарте.
say "5/6  Диспетчер мощности передатчика"
cat >/etc/NetworkManager/dispatcher.d/90-car-ap-boost <<BOOST
#!/bin/sh
# Точка доступа машинки поднялась → снимаем ограничение мощности.
[ "\$2" = "up" ] || exit 0
[ "\${CONNECTION_ID:-}" = "${CON}" ] || exit 0
iw reg set ${REG} 2>/dev/null || true
iw dev "\$1" set txpower fixed ${TXPOWER} 2>/dev/null || true
logger -t car-ap-boost "\$1: reg ${REG}, txpower ${TXPOWER}"
BOOST
chmod 755 /etc/NetworkManager/dispatcher.d/90-car-ap-boost
systemctl is-active --quiet NetworkManager-dispatcher || systemctl start NetworkManager-dispatcher || true
ok "reg ${REG}, txpower ${TXPOWER} — при каждом подъёме ${CON}"

# ─── 6. поднять сейчас, если ещё не в эфире ─────────────────────────────────
# Тот же принцип, что в main.py: активную точку НЕ трогаем, иначе она
# переактивируется и все клиенты вылетят.
say "6/6  Точка доступа"
CUR_DEV=$(nmcli -t -f NAME,DEVICE con show --active | awk -F: -v c="${CON}" '$1==c{print $2}')
if [ -n "$CUR_DEV" ]; then
  ok "уже в эфире на ${CUR_DEV} — не перезапускаю (иначе клиенты вылетят)"
  [ "$CUR_DEV" = "$AP_IFACE" ] || warn "сейчас точка на ${CUR_DEV}, после перезагрузки поднимется на ${AP_IFACE} — так и задумано"
else
  nmcli con up "${CON}" >/dev/null && ok "поднята" || warn "поднять не удалось: journalctl -u NetworkManager -n 30"
fi

say "Готово."
echo "  Сеть:     ${SSID}   пароль 12345678   адрес 10.42.0.1"
echo "  Адаптер:  ${AP_IFACE} (${AP_DRV}), привязка по ${BIND}"
echo "  Проверка: sudo reboot → через полминуты сеть должна появиться сама."
echo "  main.py не меняли: он увидит поднятую точку и не станет её трогать."
