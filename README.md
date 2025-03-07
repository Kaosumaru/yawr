# YAWR

[![npm package][npm-img]][npm-url]
[![Build Status][build-img]][build-url]
[![Downloads][downloads-img]][downloads-url]
[![Issues][issues-img]][issues-url]
[![Code Coverage][codecov-img]][codecov-url]
[![Commitizen Friendly][commitizen-img]][commitizen-url]
[![Semantic Release][semantic-release-img]][semantic-release-url]

> Yet Another Websocket RPC

## Install

```bash
npm install yawr
```

## Usage

```ts
import { RPCServer } from 'yawr';

const server = new RPCServer(8080);
server.RegisterFunction("echo", async (ctx, data: string) => {
        return data;
    });
```

## API

TODO

[build-img]:https://github.com/kaosumaru/yawr/actions/workflows/release.yml/badge.svg
[build-url]:https://github.com/kaosumaru/yawr/actions/workflows/release.yml
[downloads-img]:https://img.shields.io/npm/dt/yawr
[downloads-url]:https://www.npmtrends.com/yawr
[npm-img]:https://img.shields.io/npm/v/yawr
[npm-url]:https://www.npmjs.com/package/yawr
[issues-img]:https://img.shields.io/github/issues/kaosumaru/yawr
[issues-url]:https://github.com/kaosumaru/yawr/issues
[codecov-img]:https://codecov.io/gh/kaosumaru/yawr/branch/main/graph/badge.svg
[codecov-url]:https://codecov.io/gh/kaosumaru/yawr
[semantic-release-img]:https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg
[semantic-release-url]:https://github.com/semantic-release/semantic-release
[commitizen-img]:https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[commitizen-url]:http://commitizen.github.io/cz-cli/
