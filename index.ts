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
    },
    headless: {
      type: "string",
      default: "true",
    },
    "user-data-dir": {
      type: "string",
      default: "./data",
    },
  },
  strict: true,
  allowPositionals: true,
});

const urls = positionals.slice(2);

if (!urls.length) {
  throw new Error("No URLs given");
}

const slugs = [];

for (const url of urls) {
  const match = url.match(/(?<=fakku\.net\/hentai\/)[^\/]+/)?.[0];

  if (!match) {
    throw new Error("Invalid FAKKU URL");
  }

  slugs.push(match);
}

const browser = await puppeteer.launch({
  args: ["--disable-web-security"],
  userDataDir: values["user-data-dir"],
  headless: values.headless === "true",
});
const page = await browser.newPage();

await page.goto("https://www.fakku.net/login", { waitUntil: "networkidle0" });

const el = await page.$("button[name='login'");

if (el) {
  console.log('Login then press "Enter" to continue');
  for await (const _ of console) {
    break;
  }
}

await page.goto("https://www.fakku.net/", { waitUntil: "networkidle0" });

const getMetadata = async (slug: string): Promise<Metadata> => {
  console.log(`(${slug}) Getting metadata`);

  await page.goto(`https://www.fakku.net/hentai/${slug}`, { waitUntil: "networkidle0" });

  const html = await page.evaluate(() => document.querySelector("*")!.outerHTML);
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

  const pagesMatch = infoDivs.find((div) => div.childNodes[1]?.textContent == "Pages")?.childNodes[3]?.textContent?.match(/\d+/)?.[0];

  if (pagesMatch) {
    metadata.Pages = parseInt(pagesMatch);
  }

  const thumbnail = root.querySelector('img[src*="/thumbs/"]')!.getAttribute("src")!;
  metadata.ThumbnailIndex = parseInt(thumbnail.split("/").at(-1)!.match(/\d+/)![0]!) - 1;

  return metadata;
};

const download = async (slug: string) => {
  const metadata = await getMetadata(slug);

  const _page = await browser.newPage();
  await _page.setViewport({ width: 3840, height: 2160 });
  const client = await _page.createCDPSession();
  // @ts-ignore
  const interceptManager = new RequestInterceptionManager(client);

  const pageData = await new Promise<PageData>(async (resolve, reject) => {
    const timeout = setTimeout(reject, 30000);

    await interceptManager.intercept({
      urlPattern: "*/read",
      resourceType: "XHR",
      modifyResponse({ body }) {
        if (body) {
          clearTimeout(timeout);
          resolve(JSON.parse(body));
        }

        return { body };
      },
    });

    await _page.goto(`https://www.fakku.net/hentai/${slug}/read/page/1`);
  });

  const pages: { page: number; url: string }[] = [];

  for (const [_, { page }] of Object.entries(pageData.pages)) {
    const path = `downloads/${slug}/${page}.png`;

    if (await Bun.file(path).exists()) {
      await _page.evaluate(async () => {
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

        const y2 = Math.floor(Math.random() * (y1 + 5 - (y1 - 5) + 1)) + (y1 - 5);
        const x2 = Math.floor(Math.random() * (x1 + 5 - (x1 - 5) + 1)) + (x1 - 5);

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

    const url = await _page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 100));

      let canvas: HTMLCanvasElement | null = document.querySelector("[data-name='PageView'] > canvas");

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

        const y2 = Math.floor(Math.random() * (y1 + 5 - (y1 - 5) + 1)) + (y1 - 5);
        const x2 = Math.floor(Math.random() * (x1 + 5 - (x1 - 5) + 1)) + (x1 - 5);

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
        const path = `downloads/${slug}/${a}_${b}.png`;

        if (await Bun.file(path).exists()) {
          continue;
        }

        const bufferA = await Bun.file(`downloads/${slug}/${a}.png`).arrayBuffer();
        const bufferB = await Bun.file(`downloads/${slug}/${b}.png`).arrayBuffer();

        const img = await (await joinImages([Buffer.from(bufferA), Buffer.from(bufferB)], { direction: "horizontal" })).removeAlpha().png().toBuffer();
        Bun.write(path, img);
      }
    }
  }

  _page.close();

  Bun.write(`downloads/${slug}/info.yaml`, yaml.stringify(metadata));

  console.log(`(${slug}) Finished`);
};

for (const slug of slugs) {
  await download(slug);
}

browser.close();
