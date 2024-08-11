import joinImages from "join-images";
import { parse } from "node-html-parser";
import puppeteer from "puppeteer-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { RequestInterceptionManager } from "puppeteer-intercept-and-modify-requests";
import sharp from "sharp";
import { parseArgs } from "util";
import yaml from "yaml";

puppeteer.use(stealthPlugin());

export interface Metadata {
  Title?: string;
  Artist?: string[];
  Circle?: string[];
  Description?: string;
  Parody?: string[];
  URL?: string;
  Tags?: string[];
  Publisher?: string[];
  Magazine?: string[];
  Event?: string[];
  Pages?: number;
  ThumbnailIndex?: number;
}

interface PageData {
  pages: {
    [key: string]: {
      page: number;
    };
  };
  spreads: [number, number][];
}

const { values, positionals } = parseArgs({
  args: Bun.argv,
  options: {
    spreads: {
      type: "boolean",
      short: "s",
    },
    headless: {
      type: "string",
      default: "true",
      short: "h",
    },
    "user-data-dir": {
      type: "string",
      short: "u",
    },
    "download-dir": {
      type: "string",
      default: "./downloads",
      short: "d",
    },
    file: {
      type: "string",
      short: "f",
    },
  },
  strict: true,
  allowPositionals: true,
});

const downloadDir = values["download-dir"]
  ? values["download-dir"]
  : process.env.DOWNLOAD_DIR ?? "./downloads";

const urls = await (async () => {
  if (values.file) {
    const text = await Bun.file(values.file).text();
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length);
  } else {
    const urls = positionals.slice(2);

    if (!urls.length) {
      throw new Error("No URLs given");
    }

    return urls;
  }
})();

const slugs = [];

for (const [i, url] of urls.entries()) {
  const match = url.match(/(?<=fakku\.net\/hentai\/)[^\/]+/)?.[0];

  if (!match) {
    throw new Error(`Invalid FAKKU URL (${i}) '${url}`);
  }

  slugs.push(match);
}

const browser = await puppeteer.launch({
  args: ["--disable-web-security"],
  userDataDir: values["user-data-dir"]
    ? values["user-data-dir"]
    : process.env.USER_DATA_DIR ?? "./data",
  headless: values.headless ? values.headless === "true" : true,
});
const tab = await browser.newPage();
tab.setViewport({ width: 3840, height: 2160 });

await tab.goto("https://www.fakku.net/login", { waitUntil: "networkidle0" });

const loginButton = await tab.$("button[name='login']");

if (loginButton) {
  console.log('Login then press "Enter" to continue');

  for await (const _ of console) {
    break;
  }
}

await tab.goto("https://www.fakku.net/", { waitUntil: "networkidle0" });

const getMetadata = async (slug: string): Promise<Metadata> => {
  console.log(`(${slug}) Getting metadata`);

  const html = await tab.evaluate(() => document.querySelector("*")!.outerHTML);
  const root = parse(html);
  const infoDivs = Array.from(root.querySelectorAll(".table.text-sm.w-full"));

  let metadata: Metadata = {
    Title: root.querySelector("h1")?.textContent?.trim(),
  };

  const artists = infoDivs
    .find((div) => div.childNodes[1]?.textContent == "Events")
    ?.querySelectorAll("a")
    .map((a) => a.textContent.trim());

  if (artists) {
    metadata.Artist = artists;
  }

  const circles = infoDivs
    .find((div) => div.childNodes[1]?.textContent == "Circle")
    ?.querySelectorAll("a")
    .map((a) => a.textContent.trim());

  if (circles) {
    metadata.Circle = circles;
  }

  if (infoDivs.at(-2)!.childNodes.length === 1) {
    metadata.Description = infoDivs.at(-2)!.textContent.trim();
  }

  const parodies = infoDivs
    .find((div) => div.childNodes[1]?.textContent == "Parody")
    ?.querySelectorAll("a")
    .map((a) => a.textContent.trim());

  if (parodies) {
    metadata.Parody = parodies;
  }

  metadata.URL = `https://www.fakku.net/hentai/${slug}`;

  metadata.Tags = infoDivs
    .at(-1)!
    .querySelectorAll('a[href^="/tags/"]')
    .map((a) => a.textContent.trim());

  const publishers = infoDivs
    .find((div) => div.childNodes[1]?.textContent == "Publisher")
    ?.querySelectorAll("a")
    .map((a) => a.textContent.trim());

  if (publishers) {
    metadata.Publisher = publishers;
  }

  const magazines = infoDivs
    .find((div) => div.childNodes[1]?.textContent == "Magazine")
    ?.querySelectorAll("a")
    .map((a) => a.textContent.trim());

  if (magazines) {
    metadata.Magazine = magazines;
  }

  const events = infoDivs
    .find((div) => div.childNodes[1]?.textContent == "Event")
    ?.querySelectorAll("a")
    .map((a) => a.textContent.trim());

  if (events) {
    metadata.Event = events;
  }

  const pagesMatch = infoDivs
    .find((div) => div.childNodes[1]?.textContent == "Pages")
    ?.childNodes[3]?.textContent?.match(/\d+/)?.[0];

  if (pagesMatch) {
    metadata.Pages = parseInt(pagesMatch);
  }

  const thumbnail = root
    .querySelector('img[src*="/thumbs/"]')!
    .getAttribute("src")!;
  metadata.ThumbnailIndex =
    parseInt(thumbnail.split("/").at(-1)!.match(/\d+/)![0]!) - 1;

  return metadata;
};

const done: Set<String> = await (async () => {
  try {
    const text = await Bun.file("done.txt").text();

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

const download = async (slug: string) => {
  const url = `https://www.fakku.net/hentai/${slug}`;

  if (done.has(url)) {
    return;
  }

  await tab.goto(url, {
    waitUntil: "networkidle0",
  });

  if (
    !(await tab.$(
      ".table-cell.w-full.align-top.text-left a[href='/unlimited']"
    ))
  ) {
    done.add(url);
    Bun.write("done.txt", Array.from(done).join("\n"));

    return;
  }

  const metadata = await getMetadata(slug);

  await Promise.all([
    tab.waitForNavigation(),
    tab.click("a[title='Start Reading']"),
  ]);

  const client = await tab.createCDPSession();

  // @ts-ignore
  const interceptManager = new RequestInterceptionManager(client);

  const pageData = await new Promise<PageData>(async (resolve, reject) => {
    const timeout = setTimeout(reject, 10000);

    await interceptManager.intercept({
      urlPattern: `https://reader.fakku.net/hentai/${slug}/read`,
      resourceType: "XHR",
      modifyResponse({ body }) {
        if (body) {
          clearTimeout(timeout);
          resolve(JSON.parse(body));
        }

        return { body };
      },
    });

    await tab.goto(`https://www.fakku.net/hentai/${slug}/read`, {
      waitUntil: "networkidle2",
    });
  });

  const pages: { page: number; url: string }[] = [];

  for (const [_, { page }] of Object.entries(pageData.pages)) {
    const path = `${downloadDir}/${slug}/${page}.png`;

    if (await Bun.file(path).exists()) {
      await tab.evaluate(async () => {
        const y1 = Math.floor(Math.random() * (400 - 10 + 1)) + 10;
        const x1 = Math.floor(Math.random() * (400 - 10 + 1)) + 10;

        document.documentElement.dispatchEvent(
          new MouseEvent("mousedown", {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: y1,
            clientY: x1,
            button: 0,
          })
        );

        await new Promise((r) => setTimeout(r, 100));

        const y2 =
          Math.floor(Math.random() * (y1 + 5 - (y1 - 5) + 1)) + (y1 - 5);
        const x2 =
          Math.floor(Math.random() * (x1 + 5 - (x1 - 5) + 1)) + (x1 - 5);

        document.documentElement.dispatchEvent(
          new MouseEvent("mouseup", {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: y2,
            clientY: x2,
            button: 0,
          })
        );
      });

      continue;
    }

    console.log(`(${slug}) Getting page ${page}`);

    const url = await tab.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 100));

      let canvas: HTMLCanvasElement | null = document.querySelector(
        "[data-name='PageView'] > canvas"
      );

      while (!canvas) {
        await new Promise((r) => setTimeout(r, 100));
        canvas = document.querySelector("[data-name='PageView'] > canvas");
      }

      if (canvas) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r));

        const y1 = Math.floor(Math.random() * (400 - 10 + 1)) + 10;
        const x1 = Math.floor(Math.random() * (400 - 10 + 1)) + 10;

        document.documentElement.dispatchEvent(
          new MouseEvent("mousedown", {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: y1,
            clientY: x1,
            button: 0,
          })
        );

        await new Promise((r) => setTimeout(r, 100));

        const y2 =
          Math.floor(Math.random() * (y1 + 5 - (y1 - 5) + 1)) + (y1 - 5);
        const x2 =
          Math.floor(Math.random() * (x1 + 5 - (x1 - 5) + 1)) + (x1 - 5);

        document.documentElement.dispatchEvent(
          new MouseEvent("mouseup", {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: y2,
            clientY: x2,
            button: 0,
          })
        );

        if (blob) {
          return new Promise<string>((r) => {
            const reader = new FileReader();
            reader.onload = () => r(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }
      }
    });

    if (url) {
      pages.push({ page, url });
      const res = await fetch(url);
      const buffer = await res.arrayBuffer();
      const img = await sharp(buffer).removeAlpha().png().toBuffer();
      Bun.write(path, img);
    }
  }

  if (pageData.spreads.length && values.spreads) {
    console.log(`(${slug}) Creating spread images`);

    for (const [a, b] of pageData.spreads) {
      if (b > a) {
        const path = `${downloadDir}/${slug}/${a}_${b}.png`;

        if (await Bun.file(path).exists()) {
          continue;
        }

        const bufferA = await Bun.file(
          `${downloadDir}/${slug}/${a}.png`
        ).arrayBuffer();
        const bufferB = await Bun.file(
          `${downloadDir}/${slug}/${b}.png`
        ).arrayBuffer();

        const img = await (
          await joinImages([Buffer.from(bufferA), Buffer.from(bufferB)], {
            direction: "horizontal",
          })
        )
          .removeAlpha()
          .png()
          .toBuffer();
        Bun.write(path, img);
      }
    }
  }

  Bun.write(`${downloadDir}/${slug}/info.yaml`, yaml.stringify(metadata));

  done.add(`https://www.fakku.net/hentai/${slug}`);
  Bun.write("done.txt", Array.from(done).join("\n"));

  console.log(`(${slug}) Finished`);
};

for (const slug of slugs) {
  await download(slug);
}

browser.close();
