/**
 * Follow-up suggestions (20261115-mobile.md gap analysis vs Kimi / Grok bot).
 *
 * Both apps put two or three tappable next questions under the newest reply.
 * The desktop has no model call to generate them, so the phone derives them
 * from the answer's shape: code answers offer code follow-ups, risk/decision
 * answers offer risk follow-ups, long prose offers a summary. Cheap, local and
 * honest — they are shortcuts, not invented facts.
 */

export const MAX_FOLLOW_UPS = 3

const CODE = /```|\bfunction\b|\bconst\b|\breturn\b|\bimport\b|=>/
const RISK = /风险|问题|失败|回滚|回退|坑|隐患|注意/
const LONG = 280

function push(list: string[], value: string): void {
  if (!list.includes(value) && list.length < MAX_FOLLOW_UPS) list.push(value)
}

export function followUpsFor(markdown: string): string[] {
  const text = (markdown ?? '').trim()
  if (!text) return []
  const list: string[] = []

  if (CODE.test(text)) {
    push(list, '解释这段代码')
    push(list, '补一个测试')
    push(list, '改成更简单的写法')
  }
  if (RISK.test(text)) {
    push(list, '展开风险')
    push(list, '给出修复方案')
    push(list, '列出验证步骤')
  }
  if (text.length > LONG) {
    push(list, '总结成三点')
    push(list, '展开最后一点')
    push(list, '给一个例子')
  }
  push(list, '展开细节')
  push(list, '给出例子')
  push(list, '总结成要点')
  return list
}
