import { parseArgs } from "util";
import type { Options } from "./types";

const { values, positionals } = parseArgs({
  args: Bun.argv,
  options: {
    spreads: {
      type: "boolean",
      short: "s",
    },
    'no-headless': {
      short: "h",
      type: "boolean",
      default: false,
    },
    "user-data-dir": {
      type: "string",
      short: "u",
    },
    "download-dir": {
      type: "string",
      short: "d",
    },
    timeout: {
      type: "string",
      default: "20000",
    },
    file: {
      type: "string",
      short: "f",
    },
    jpegtran: {
      type: "boolean",
      default: false,
    },
    force: {
      type: "boolean",
      default: false,
    },
    direct: {
      type: "boolean",
      default: false,
    },
    cookies: {
      type: "string",
    },
  },
  strict: true,
  allowPositionals: true,
});

const downloadDir =
  values["download-dir"] ?? process.env.DOWNLOAD_DIR ?? "./downloads";

const userDataDir =
  values["user-data-dir"] ?? process.env.USER_DATA_DIR ?? "./data";

const useJpegtran =
  values["jpegtran"] === true || process.env.JPEGTRAN === "true";

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

const slugs: string[] = [];

for (const [i, url] of urls.entries()) {
  const match = url.match(/(?<=fakku\.net\/hentai\/)[^\/]+/)?.[0];

  if (!match) {
    throw new Error(`Invalid FAKKU URL (${i}) '${url}`);
  }

  slugs.push(match);
}

const options: Options = {
  force: values.force,
  downloadDir,
  userDataDir,
  headless: values["no-headless"] === false,
  useJpegtran,
  timeout: parseInt(values.timeout!),
  spreads: values.spreads,
  direct: values.direct,
  cookies: values.cookies,
};

export { options, slugs };
