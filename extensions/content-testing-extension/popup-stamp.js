// "New Stamp" tab: summary of the last New Stamp Audit and a button that opens the full page.
const $ = (id) => document.getElementById(id);

(async () => {
  const { nsAudit } = await chrome.storage.local.get("nsAudit");
  const box = $("stampLast");
  if (nsAudit && nsAudit.results && nsAudit.results.length) {
    const n = (s) => nsAudit.results.filter((r) => r.status === s).length;
    const remove = n("remove"), keep = n("keep"), other = nsAudit.results.length - remove - keep;
    box.textContent = "";
    const big = document.createElement("div");
    big.className = "stampBig";
    // SKU + CountryID audits count rows (one per SKU and country).
    const unit = nsAudit.perCountry ? "SKU/country row" : "SKU";
    big.innerHTML = `<b></b> ${unit}<span></span> due for stamp removal`;
    big.querySelector("b").textContent = remove;
    big.querySelector("span").textContent = remove === 1 ? " is" : "s are";
    const meta = document.createElement("div");
    meta.textContent = `${nsAudit.results.length} checked as of ${nsAudit.asOf} · ${keep} keep` + (other ? ` · ${other} to review` : "");
    box.append(big, meta);
  }
})();

$("openStamp").addEventListener("click", async () => {
  const url = chrome.runtime.getURL("new-stamp/index.html");
  let existing = null;
  try { [existing] = await chrome.tabs.query({ url }); } catch {}
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
});
