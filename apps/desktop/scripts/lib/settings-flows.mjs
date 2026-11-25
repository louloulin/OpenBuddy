/** 设置相关的真机流程：magpie 本机网关预设。 */
export async function runSettingsFlows({ page, assert, checkpoint }) {
  // magpie：厂商预设里有「magpie（本机网关）」，选中后 Base URL 自动指向 127.0.0.1:3425/v1。
  await page.getByText('模型', { exact: true }).first().click();
  await page.getByRole('button', { name: '添加厂商' }).first().click();
  await page.getByRole('combobox', { name: '厂商类型' }).selectOption({ label: 'magpie（本机网关）' });
  const magpieBase = await page.getByPlaceholder('https://api.example.com/v1').inputValue();
  assert.equal(magpieBase, 'http://127.0.0.1:3425/v1');
  await page.screenshot({ path: 'release/ui-magpie-preset.png' });
  checkpoint('the magpie local-gateway preset fills the loopback base URL', { baseUrl: magpieBase });
  await page.keyboard.press('Escape');
  // Back to 安全中心 for the G2-1 tab assertions below.
  await page.getByText('安全中心', { exact: true }).first().click();
  await page.getByText('受保护路径', { exact: true }).waitFor();

  // G4-4: 手机接入面板——真实设备列表 + 推送测试；远程控制诚实禁用。
  await page.getByText('手机接入', { exact: true }).first().click();
  await page.getByText('我的手机', { exact: true }).waitFor({ timeout: 15000 });
  const pushBtn = page.getByRole('button', { name: '发送测试通知' });
  await pushBtn.click();
  await page.getByText('已在桌面弹出一条测试通知（若系统通知已开启）').first().waitFor({ timeout: 10000 });
  const remoteOff = page.getByRole('button', { name: '未开放' });
  assert.ok(await remoteOff.isDisabled(), 'remote control stays honestly disabled');
  await page.screenshot({ path: 'release/ui-mobile-access.png' });
  checkpoint('mobile access lists a real device, sends a test notification, keeps remote control disabled (G4-4)', {});
  await page.getByText('安全中心', { exact: true }).first().click();
  await page.getByText('受保护路径', { exact: true }).waitFor();
}
