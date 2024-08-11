import type { Page } from "puppeteer";

export const random = (min: number, max: number) => {
  min = Math.ceil(min);
  max = Math.floor(max);

  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const isUnlimited = async (tab: Page) =>
  tab
    .$(".table-cell.w-full.align-top.text-left a[href='/unlimited']")
    .then((el) => !!el);
