/**
 * dsh-purge (WorkBuddy port) — function-hook（mods）注册入口。
 *
 * 宿主在 CLI 启动时用隔离 realm 加载本模块（CBC_MODS_ISOLATE 默认开），因此：
 *   - 不 import 任何 node: 内建（隔离通道会 fail-closed）
 *   - 只用注入的能力面 `$` 与 console.error
 *   - 任何异常都必须放行（fail-open），不做阻断
 *
 * 作用：
 *   1) 启动期在宿主里留一行 loaded 日志，便于验证插件真的被装载
 *      （`codebuddy plugin list` 会打印 mods: loaded mod "dsh-purge"）
 *   2) 保持 prompt.submit 直通，不做任何拦截（阻断逻辑留在 shell hooks）
 */
export function register(on) {
  try {
    // eslint-disable-next-line no-console
    console.error('[dsh-purge] mod loaded (workbuddy port)');
  } catch { /* ignore */ }

  if (typeof on !== 'function') {
    return;
  }

  on('prompt.submit', async ($, e, next) => {
    // 直通：不 drop、不改 prompt。真正的内容注入走 SessionStart / UserPromptSubmit shell hook。
    return next(e);
  });
}

export default { register };
