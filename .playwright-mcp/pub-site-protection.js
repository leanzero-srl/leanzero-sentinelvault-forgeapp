async (page) => {
  const v = {"file": "sentinel-vault-site-protection.mp4", "key": "site-protection", "title": "Confluence Admin: Force Release, Trash and Restore Settings", "desc": "Sentinel Vault site settings for Confluence admins: force-unseal, protecting sealed files in the page body, and trash and restore.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nA tour of the Protection section in Sentinel Vault's site settings, with the effect of each switch shown on a real page. Allow space admins to force-unseal adds Force release to the menu of a file sealed by someone else. Protect Sealed Attachments in Page Body is switched on next. With Allow attachment removal on, an unsealed file can be sent to the trash from its card; it then shows under Missing as In the trash, with who deleted it and when. With Allow attachment restore on, it can be restored straight from the panel. Allow seal cleanup completes the set.\n\nWhat you will learn\n- Where Sentinel Vault's site settings live in Confluence administration\n- What force-unseal adds for space admins\n- Deleting and restoring attachments from the panel\n\nChapters\n00:00 Intro\n00:31 Allow space admins to force-unseal\n00:51 Force release in the card menu\n01:07 Allow attachment removal\n01:31 Delete an available file\n01:47 The file shows as missing\n01:59 Restore it from the panel\n\nWatch next\n- Confluence Seal Expiry, Reminders and Alerts: Set Up: https://youtu.be/qHFShA4mu3E\n- Confluence Seal Actions Signed With an Authenticator Code: https://youtu.be/-eUE8Hsdiik\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #ConfluenceAdmin", "tags": "Confluence admin settings, Confluence attachment restore, Confluence trash, Confluence space admin, Confluence administration, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence governance, Confluence file protection", "thumb": "thumbnails/sentinel-vault-thumb-site-protection.png", "id": "XYvwHigjkFg"};
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