/** 自动化真机流程 (G4-1)：真实跑出成功/失败记录，验证分组与失败原因聚合。 */
export async function runAutomationFlows({ page, call, checkpoint, assert, init }) {
  // G4-1: 用一个真实的自动化任务跑出记录，验证分组切换与失败原因聚合的可视化。
  const autoTask = await call('automations_save', {
    automation: {
      name: '检查自动化记录',
      prompt: '只回复 OK',
      cwds: init.cwd,
      status: 'ACTIVE',
      skills: [],
      connectorIds: [],
      permissionMode: 'fullAccess',
      scheduleType: 'recurring',
      schedule: { freq: 'DAILY', interval: 1, byday: [], bymonthday: [], bymonth: [], byhour: 9, byminute: 0, intervalHours: 24 },
    },
  });
  const autoId = autoTask?.id ?? autoTask?.automation?.id;
  await call('automations_run', { id: autoId });
  await page.waitForFunction(async () => {
    const snap = await window.openbuddy.invoke('automations_snapshot', {});
    return (snap?.records ?? []).some((r) => r.status === 'success' || r.status === 'failed');
  }, undefined, { timeout: 60000 });
  // 再造一条**失败**记录（工作目录不可用），让「失败原因」聚合有东西可显示。
  const failingTask = await call('automations_save', {
    automation: {
      name: '检查失败聚合',
      prompt: '只回复 OK',
      cwds: '/nonexistent-openbuddy-dir',
      status: 'ACTIVE',
      skills: [],
      connectorIds: [],
      permissionMode: 'fullAccess',
      scheduleType: 'recurring',
      schedule: { freq: 'DAILY', interval: 1, byday: [], bymonthday: [], bymonth: [], byhour: 9, byminute: 0, intervalHours: 24 },
    },
  });
  await call('automations_run', { id: failingTask?.id ?? failingTask?.automation?.id }).catch(() => {});
  await page.waitForFunction(async () => {
    const snap = await window.openbuddy.invoke('automations_snapshot', {});
    return (snap?.records ?? []).some((r) => r.status === 'failed');
  }, undefined, { timeout: 60000 });
  const autoNav = page.getByRole('button', { name: '自动化', exact: true });
  await autoNav.first().click();
  await page.getByText('运行记录').first().click();
  const groupTabs = await page.getByRole('tab', { name: /按日期|按任务/ }).allInnerTexts();
  assert.ok(groupTabs.includes('按日期') && groupTabs.includes('按任务'), 'grouping switch is visible with records');
  await page.getByRole('tab', { name: '按任务' }).click();
  await page.getByText('检查自动化记录').first().waitFor({ timeout: 10000 });
  const failureChips = await page.locator('.atm-failure-chip').allInnerTexts();
  assert.ok(failureChips.length > 0, 'failure reasons are aggregated');
  await page.screenshot({ path: 'release/ui-automation-records.png' });
  checkpoint('automation records group by date or task and aggregate failure reasons', { tabs: groupTabs, failureChips });
}
