/**
 * Pages 生产部署的 _worker.js：只做一件事 —— 不是 daymark.styrigx.com 的访问一律 301 到 daymark.styrigx.com。
 *
 * 页面的会话检查在主站鉴权网关（styrigx-auth-gateway），接口在 workers/ 下的接口 Worker，
 * 两者都挂在 daymark.styrigx.com 的路由上；Pages 只放静态文件，没有钥匙、没有数据绑定。
 * 但 Pages 还有 styrigx-daymark.pages.dev 和每次部署的 <hash>.styrigx-daymark.pages.dev 地址，
 * 这些地址不经过网关，必须跳回正式域名，否则页面能绕过锁屏直接打开。
 *
 * 其余请求原样交给静态文件（_headers、_redirects 照常生效）。
 */
const HOST = 'daymark.styrigx.com';

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
    return env.ASSETS.fetch(request);
  },
};
