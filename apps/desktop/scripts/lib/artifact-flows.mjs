/** 产物相关的真机流程：Mermaid 预览、独立窗口、重命名、任务成果聚合。 */
export async function runArtifactFlows({ page, app, call, checkpoint, writeFile, join, init, persisted, assert }) {
  // G3-1: a real .mmd file in the workspace renders as an SVG diagram in the workbench.
  await writeFile(join(init.cwd, 'ui-diagram.mmd'), 'graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[完成]\n  B -->|否| D[重试]\n');
  await page.getByRole('button', { name: '展开右侧栏' }).click();
  await page.getByRole('tab', { name: '文件' }).click();
  await page.getByText('ui-diagram.mmd', { exact: true }).click();
  await page.locator('.af-mermaid svg').waitFor({ timeout: 20000 });
  const diagramSvg = await page.evaluate(() => {
    const svg = document.querySelector('.af-mermaid svg');
    return svg ? { tag: svg.tagName, bytes: Math.round((svg.outerHTML || '').length) } : null;
  });
  assert.ok(diagramSvg && diagramSvg.bytes > 200, 'the mermaid artifact renders an SVG');
  await page.screenshot({ path: 'release/ui-mermaid.png' });
  checkpoint('a mermaid artifact renders as an SVG diagram', diagramSvg);

  // G3-3: 独立窗口 — 「独立阅读」→「在新窗口打开」真的开出第二个 BrowserWindow，
  // 且它的 hash 是 #/artifact/<sessionId>?path=…
  const windowsBefore = app.windows().length;
  await page.getByRole('button', { name: '更多操作' }).last().click();
  await page.getByRole('menuitem', { name: '独立阅读', exact: true }).click();
  const reader = page.getByRole('dialog', { name: /独立阅读/ });
  await reader.waitFor();
  await reader.getByRole('button', { name: '在新窗口打开' }).click();
  await page.waitForFunction(() => true, undefined, { timeout: 3000 }).catch(() => {});
  const deadline = Date.now() + 20000;
  let artifactWindowUrl = '';
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      if (w === page) continue;
      const u = w.url();
      if (u.includes('#/artifact/')) { artifactWindowUrl = u; break; }
    }
    if (artifactWindowUrl) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  assert.ok(app.windows().length > windowsBefore, 'a second window opens');
  assert.match(artifactWindowUrl, /#\/artifact\/[^/]+\?path=/);
  // The new window really shows the artifact (its workbench panel opens on that file).
  const artifactWindow = app.windows().find((w) => w !== page && w.url().includes('#/artifact/'));
  await artifactWindow.locator('.bench-viewer__name').first().waitFor({ timeout: 25000 });
  await artifactWindow.waitForFunction(
    () => document.querySelectorAll('.af-mermaid svg').length > 0,
    undefined,
    { timeout: 25000 },
  );
  const artifactWindowName = await artifactWindow.locator('.bench-viewer__name').first().innerText();
  assert.equal(artifactWindowName, 'ui-diagram.mmd');
  // The artifact lives in the profile's Pi inbox: remember its folder for the rename check.
  const artifactFilePath = decodeURIComponent(new URL(artifactWindowUrl).hash.split('path=')[1] ?? '');
  await page.screenshot({ path: 'release/ui-artifact-window.png' });
  checkpoint('an artifact opens in its own window', { windows: app.windows().length, artifact: artifactWindowName });
  for (const w of app.windows()) if (w !== page) await w.close().catch(() => {});
  await page.keyboard.press('Escape');

  // G3-7: rename a workspace artifact in place; a taken name is refused with a message.
  await page.getByRole('button', { name: '收起右侧栏' }).click();
  await page.getByRole('button', { name: '展开右侧栏' }).click();
  await page.getByRole('tab', { name: '文件' }).click();
  await page.getByText('ui-diagram.mmd', { exact: true }).click();
  await page.getByRole('button', { name: '更多操作' }).last().click();
  await page.getByRole('menuitem', { name: '重命名…' }).click();
  const renameInput = page.getByRole('textbox', { name: '新文件名' });
  // A sibling file with the target name makes the conflict real.
  await writeFile(join(artifactFilePath.slice(0, artifactFilePath.lastIndexOf('/')), 'ui-taken.mmd'), 'taken\n');
  await renameInput.fill('ui-taken.mmd');
  await page.getByRole('button', { name: '确定' }).click();
  await page.getByRole('alert').filter({ hasText: '同名文件已存在' }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: 'release/ui-rename-conflict.png' });
  await renameInput.fill('ui-diagram-renamed.mmd');
  await page.getByRole('button', { name: '确定' }).click();
  await page.waitForFunction(
    () => [...document.querySelectorAll('.bench-viewer__name, .bench-tab__label')].some((el) => el.textContent === 'ui-diagram-renamed.mmd'),
    undefined,
    { timeout: 15000 },
  );
  await page.screenshot({ path: 'release/ui-renamed.png' });
  checkpoint('an artifact renames in place and refuses a taken name', { renamed: 'ui-diagram-renamed.mmd' });
  await page.getByRole('button', { name: '收起右侧栏' }).click();

  const beforeFiles = await app.evaluate(() => globalThis.__ipcAudit.length);
  await writeFile(join(init.cwd, 'ui-local-marker.txt'), 'local listing fixture');
  const more = page.getByRole('button', { name: /更多.*文件/ });
  await more.hover(); await page.getByRole('menuitem', { name: '我的文件', exact: true }).click();
  await page.locator('.myfiles-tab--active').filter({ hasText: '本地文件' }).waitFor();
  await page.getByText('ui-local-marker.txt', { exact: true }).waitFor();
  const fileCommands = await app.evaluate(start => globalThis.__ipcAudit.slice(start), beforeFiles);
  assert.equal(fileCommands.some(item => ['memory_list', 'browse_directory'].includes(item.command)), false);
  assert.ok(fileCommands.some(item => item.command === 'list_dir' && item.status === 'resolved'));
  await page.screenshot({ path: 'release/electron-ui-files.png', fullPage: true });
  checkpoint('MyFiles defaults to real list_dir and never invokes unsupported memory artifacts', { commands: fileCommands });

  // G3-5: 「任务成果」页签把各任务的产物汇总出来（host 直接读磁盘上的 checkpoint 索引）。
  // 直接写盘的文件没有 checkpoint，所以先用真正的 artifact_save 造一份任务成果。
  await call('artifact_save', { sessionId: persisted.sessionId, path: join(init.cwd, 'ui-task-result.md'), content: '# 任务成果\ntask artifact\n' });
  await page.getByRole('button', { name: '任务成果' }).click();
  const artifactRow = page.getByRole('button', { name: /^ui-task-result\.md$/ }).first();
  await artifactRow.waitFor({ timeout: 15000 });
  const artifactRowName = await artifactRow.innerText();
  await page.screenshot({ path: 'release/ui-task-artifacts.png' });
  checkpoint('the task-artifacts tab aggregates artifacts across tasks', { artifact: artifactRowName });

  // G3-6: 「默认打开方式」偏好接入我的文件——默认应用内预览，设为系统应用后交给系统。
  await call('default_open_set', { defaultOpen: {} });
  await page.locator('.myfiles-tabs').getByRole('button', { name: '本地文件' }).click();
  await page.getByText('ui-reference.md', { exact: true }).click();
  await page.getByRole('complementary', { name: '文件预览' }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: 'release/ui-myfiles-preview.png' });
  const embeddedOpen = await page.evaluate(() => document.querySelectorAll('.myfiles-preview').length);
  assert.equal(embeddedOpen, 1, 'embedded preview opens by preference');
  await page.getByRole('button', { name: '关闭预览' }).click();

  // 改成「系统应用」后，同一个文件不再就地预览（偏好即时生效，不需要重启）。
  await call('default_open_set', { defaultOpen: { markdown: 'system' } });
  await page.getByText('ui-reference.md', { exact: true }).click();
  await page.waitForTimeout(800);
  const systemOpened = await page.evaluate(() => document.querySelectorAll('.myfiles-preview').length);
  assert.equal(systemOpened, 0, 'system preference skips the embedded preview');
  checkpoint('default-open preference switches my-files between embedded preview and the system app (G3-6)', { embedded: embeddedOpen, system: systemOpened });
  await call('default_open_set', { defaultOpen: {} });

  // G3-4: 分享面板的可见性只读展示「仅本机」，本地分享走真实系统调用。
  await page.locator('.myfiles-tabs').getByRole('button', { name: '本地文件' }).click();
  // 「我的文件」是占位视图，没有右侧栏：先回到会话再打开产物面板。
  await page.locator('.sidebar__conv').first().click();
  await page.getByRole('button', { name: '展开右侧栏' }).click();
  await page.getByRole('tab', { name: '文件' }).click();
  await page.getByText('ui-task-result.md', { exact: true }).click();
  await page.getByRole('button', { name: '更多操作' }).last().click();
  await page.getByRole('menuitem', { name: '分享…' }).click();
  const visibility = page.getByRole('note');
  await visibility.waitFor({ timeout: 10000 });
  const visibilityText = (await visibility.innerText()).replace(/\s+/g, ' ');
  assert.ok(visibilityText.includes('仅本机'), 'visibility is shown as local-only');
  // 面板里还有同名的工具条按钮，这里限定在分享面板内的条目。
  const sharePanel = page.locator('.bench-share');
  const localOpen = sharePanel.getByRole('button', { name: /用默认应用打开/ });
  const localReveal = sharePanel.getByRole('button', { name: /在文件夹中显示/ });
  const cloudItemInPanel = sharePanel.getByRole('button', { name: /云端链接/ });
  assert.ok(await cloudItemInPanel.isDisabled(), 'cloud link stays honestly disabled');
  assert.ok(await localOpen.isEnabled() && await localReveal.isEnabled(), 'local share actions are real');
  await page.screenshot({ path: 'release/ui-share-visibility.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '收起右侧栏' }).click();
  checkpoint('share shows local-only visibility with real local actions (G3-4)', { visibility: visibilityText.slice(0, 40) });
}
