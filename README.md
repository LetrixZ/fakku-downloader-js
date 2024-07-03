# FAKKU Downloader

More information about how it works here: https://github.com/LetrixZ/fakku-downloader-py

## Requirements

- [Bun](https://bun.sh/)

## Usage

```sh
$ bun run index.ts URL_1 URL_2 ...
```

### Arguments

- `spreads`: Indicates if it should join spread images together.
- `headless`: Indicates if the browser window should be opened. Run with `--headless false` the first time to login and save the cookies. Defaults to `true`.
- `user-data-dir`: Indicates the location of Chrome profiles. Defaults to `./data`.
