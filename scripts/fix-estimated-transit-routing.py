from pathlib import Path

root = Path(__file__).resolve().parents[1]
tracking_path = root / "app" / "lib" / "tracking.ts"
test_path = root / "tests" / "cargo-watch.test.mjs"

tracking = tracking_path.read_text(encoding="utf-8")

sinotrans_old = '''    status: atd
      ? scheduleStatus(etd, atd, eta, ata)
      : etd && etd >= chinaTimestamp()
        ? "待开船"
        : "可能延期",'''
sinotrans_new = '''    status: scheduleStatus(etd, atd, eta, ata),'''
if sinotrans_old in tracking:
    tracking = tracking.replace(sinotrans_old, sinotrans_new, 1)
elif "export async function querySinotrans" in tracking:
    start = tracking.index("export async function querySinotrans")
    end = tracking.index("function panconPortAlias", start)
    if sinotrans_new not in tracking[start:end]:
        raise SystemExit("Sinotrans status branch was not updated")

cosco_old = '''  const status = ata
    ? "已到港"
    : atd
      ? eta && eta < now
        ? "可能延期"
        : "运输中"
      : etd && etd >= now
        ? "待开船"
        : eta && eta >= now
          ? "运输中"
          : "可能延期";'''
cosco_new = '''  const status = scheduleStatus(etd, atd, eta, ata);'''
if cosco_old in tracking:
    tracking = tracking.replace(cosco_old, cosco_new, 1)
elif "async function queryCoscoGlobal" in tracking:
    start = tracking.index("async function queryCoscoGlobal")
    end = tracking.index("function schedulePortKey", start)
    if cosco_new not in tracking[start:end]:
        raise SystemExit("COSCO status branch was not updated")

tracking_path.write_text(tracking, encoding="utf-8")

tests = test_path.read_text(encoding="utf-8")
marker = 'test("carrier-specific schedule status uses estimated in transit"'
block = r'''
test("carrier-specific schedule status uses estimated in transit", async () => {
  const tracking = await readFile(new URL("app/lib/tracking.ts", root), "utf8");
  assert.match(
    tracking,
    /export async function querySinotrans[\s\S]*?status: scheduleStatus\(etd, atd, eta, ata\),[\s\S]*?source: "中外运集运官网船期"/
  );
  assert.match(
    tracking,
    /async function queryPancon[\s\S]*?const status = scheduleStatus\(etd, atd, eta, ata\);[\s\S]*?source: "PANCON 官网船期"/
  );
  assert.match(
    tracking,
    /async function queryCoscoGlobal[\s\S]*?const status = scheduleStatus\(etd, atd, eta, ata\);[\s\S]*?source: "COSCO eLines 全球官网船期"/
  );
});
'''
if marker not in tests:
    tests = tests.rstrip() + "\n\n" + block.strip() + "\n"
test_path.write_text(tests, encoding="utf-8")
