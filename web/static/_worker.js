/**
 * Pages 生产部署的 _worker.js：只做两件事 ——
 *   1. 不是 daymark.styrigx.com 的访问一律 301 到 daymark.styrigx.com；
 *   2. 一张图片都不出（图片一律要过会话，Sloan 2026-10-29「一律都得过验证」）。
 *
 * 页面的会话检查在主站鉴权网关（styrigx-auth-gateway），接口在 workers/ 下的接口 Worker，
 * 两者都挂在 daymark.styrigx.com 的路由上；Pages 只放静态文件，没有钥匙、没有数据绑定。
 * 但 Pages 还有 styrigx-daymark.pages.dev 和每次部署的 <hash>.styrigx-daymark.pages.dev 地址，
 * 这些地址不经过网关，必须跳回正式域名，否则页面能绕过锁屏直接打开。
 *
 * 为什么在这里拦图片：Pages 不验会话、不持钥匙；网关对子站带图片后缀的路径不验会话直接回源（网关 src/subsites.js 的
 * STATIC_EXT，给 js/css/字体用的白名单顺带放了图片）。所以 Pages 上只要有一张图，没会话也能拿到。
 * 这里按后缀和 Content-Type 双重判断，像图片的一律 404（不带正文、no-store），仓库里也不放图片文件（tests/web/pages-static.test.mjs、CI 构建产物检查）。
 * 本站没有图片；以后要加图，也只能从接口 Worker styrigx-daymark-core 的 /api/* 出（先问网关会话）。
 * 页面上的标签页图标 / 抽屉头像都指向主站 https://styrigx.com/avatar/…（主站账号 Worker 出的公开头像，主站锁屏本身要用）。
 * 例外只有一个：_redirects 里 /favicon.ico → 主站头像的 302。跳转不带任何图片字节，原样放行。
 *
 * 其余请求原样交给静态文件（_headers、_redirects 照常生效）。
 */
const HOST = 'daymark.styrigx.com';

/* 图片后缀（含少见的格式；大小写不敏感） */
const IMAGE_EXT = /\.(png|apng|jpe?g|jfif|pjpeg|pjp|gif|webp|avif|svgz?|ico|cur|bmp|tiff?|heic|heif|jxl)$/i;

/** 像不像图片：路径后缀或回答的 Content-Type（没有后缀的图片文件也拦） */
function imageLike(pathname, contentType) {
  if (IMAGE_EXT.test(pathname)) return true;
  return /^\s*image\//i.test(contentType || '');
}

function notFound() {
  return new Response('not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch(req: Request): Promise<Response> } }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== HOST) {
      return new Response(null, {
        status: 301,
        headers: { 'Location': 'https://' + HOST + url.pathname + url.search, 'Cache-Control': 'no-store' },
      });
    }
    const res = await env.ASSETS.fetch(request);
    /* 跳转（_redirects、补尾斜杠）不带正文，放行；跳到的地址再来一次请求还会经过这里 */
    if (res.status >= 300 && res.status < 400) return res;
    if (imageLike(url.pathname, res.headers.get('Content-Type'))) {
      if (res.body) res.body.cancel().catch(() => {});
      return notFound();
    }
    return res;
  },
};
