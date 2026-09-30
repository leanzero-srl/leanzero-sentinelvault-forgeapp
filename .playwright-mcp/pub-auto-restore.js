async (page) => {
  const v = {"file": "sentinel-vault-auto-restore.mp4", "key": "auto-restore", "title": "Confluence Attachment Overwritten? Sealed Files Revert", "desc": "A colleague uploads a new version over a sealed Confluence attachment. Sentinel Vault reverts it on its own and tells both people why.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nThis is what a seal is for. Mihai opens the page's Attachments list and uploads a new version of Regim caini.pdf, a file Gabriela has sealed. For a moment the row shows him as the creator. Then Sentinel Vault puts the sealed version back: the top version is now created by Sentinel Vault with the comment \"automatically reversed modifications\", Mihai's ribbon says his change was reverted because the attachment is sealed by its owner, and a Seal Violation notification names both the owner and the editor. The comment on the page also says the editor's version is kept in the page history, so nothing is thrown away.\n\nWhat you will learn\n- What happens when someone overwrites a sealed attachment\n- How the owner and the editor are both told\n- Where the overwritten version still lives\n\nChapters\n00:00 Intro\n00:11 Upload a new version of the file\n00:27 Sentinel Vault reverts it\n00:47 The violation comment\n\nWatch next\n- Confluence Attachment Lock: Seal a File in One Click: https://youtu.be/BFDpA4Y1Tgk\n- Confluence Section Lock: Seal One Heading, Edit the Rest: https://youtu.be/I7VR1Cih9rg\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #DocumentControl", "tags": "Confluence attachment overwrite, Confluence file versioning, Confluence revert attachment, Confluence file protection, Confluence Cloud, Atlassian Forge, Sentinel Vault, document control Confluence, Confluence governance, Confluence admin", "thumb": "thumbnails/sentinel-vault-thumb-auto-restore.png", "id": "8YFcmh_-MJg"};
  const dir = '/Users/mihaiperdum/Downloads/SentinelVault-YouTube/';
  const log = [];
  page.on('dialog', d => d.accept());
  await page.goto('https://studio.youtube.com/video/' + v.id + '/edit');
  const title = page.getByRole('textbox', { name: /Add a title/ });
  await title.waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
  await title.fill(v.title);
  await page.getByRole('textbox', { name: /Tell viewers/ }).fill(v.desc);
  await page.getByRole('radio', { name: "No, it's not made for kids" }).click();
  if (v.key !== 'seal-file') { await page.locator('input[type=file]').first().setInputFiles(dir + v.thumb).catch(e => log.push('thumb ' + e.message.slice(0,80))); await page.waitForTimeout(3000); }
  await page.getByRole('button', { name: 'Show advanced settings' }).click().catch(()=>{});
  await page.waitForTimeout(1500);
  const tagIn = page.locator('#tags-container input, input[aria-label="Tags"]').first();
  await tagIn.fill(v.tags + ',').catch(e => log.push('tags ' + e.message.slice(0,80)));
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(5000);
  log.push('saved');
  // publish via draft dialog
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await page.waitForTimeout(3000);
  for (let i = 0; i < 3; i++) { await page.locator('#next-button').click(); await page.waitForTimeout(1500); }
  await page.locator('tp-yt-paper-radio-button[name="PUBLIC"]').click();
  await page.waitForTimeout(1000);
  await page.locator('#done-button').click();
  await page.waitForTimeout(6000);
  log.push('published');
  return log.join('; ');
}