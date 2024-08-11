import puppeteer from "puppeteer-extra";
import blockResources from "puppeteer-extra-plugin-block-resources";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { parseArgs } from "util";

puppeteer.use(stealthPlugin());
puppeteer.use(blockResources({ blockedTypes: new Set(["image"]) }));

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    headless: {
      type: "string",
      short: "H",
    },
    "user-data-dir": {
      type: "string",
      short: "U",
    },
  },
  strict: true,
  allowPositionals: true,
});

const browser = await puppeteer.launch({
  args: ["--disable-web-security"],
  userDataDir: values["user-data-dir"]
    ? values["user-data-dir"]
    : process.env.USER_DATA_DIR ?? "./data",
  headless: values.headless ? values.headless === "true" : true,
});
const tab = await browser.newPage();

await tab.goto("https://www.fakku.net/login", { waitUntil: "networkidle0" });

const loginButton = await tab.$("button[name='login']");

if (loginButton) {
  console.log('Login then press "Enter" to continue');

  for await (const _ of console) {
    break;
  }
}

const urls: Set<String> = await (async () => {
  try {
    const text = await Bun.file("urls.txt").text();

    return new Set(
      text
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length)
    );
  } catch (e) {
    return new Set();
  }
})();

let page = 1;

await tab.goto(`https://www.fakku.net/page/${page}`, {
  waitUntil: "networkidle0",
});

while (tab.$("a[title='Next Page']")) {
  console.log(tab.url());

  (
    await Promise.all(
      (
        await tab.$$("a[href*='/hentai/'][data-testid]")
      ).map((el) =>
        el.evaluate((el) => "https://www.fakku.net" + el.getAttribute("href")!)
      )
    )
  ).forEach((url) => urls.add(url));

  page = parseInt(tab.url().split("/page/")[1].split("/")[0]);

  Bun.write("urls.txt", Array.from(urls).join("\n"));

  await Promise.all([
    tab.waitForNavigation({ waitUntil: "networkidle0" }),
    tab.click("a[title='Next Page']"),
  ]);
}

console.log("--- DONE ---");

browser.close();
