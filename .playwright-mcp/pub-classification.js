async (page) => {
  const v = {"file": "sentinel-vault-classification.mp4", "key": "classification", "title": "Confluence Classification Levels: Set a Space Default", "desc": "Turn on classification levels in Confluence, give a space a default, and every page shows it. Lowering a level asks for a reason.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nSentinel Vault's Classification tab ships four levels: Public, Internal, Confidential and Restricted. Switch classification on and every page shows its level under the title and in the ribbon. In Space defaults, WORK FOR HIRE is set to Confidential, and the page ribbon shows Confidential, from space default. Raising the default to Restricted is one action. Lowering it back to Internal asks why the content is less sensitive now, and the reason is kept in the activity log. After that, the page follows: Internal, from space default.\n\nWhat you will learn\n- Turning classification on for the site\n- Setting a default level per space\n- Why lowering a level needs a reason\n\nChapters\n00:00 Intro\n00:11 Every page shows its level\n00:23 Pick a default for a space\n00:47 The page shows it\n01:04 Lowering needs a reason\n01:20 The page follows\n\nWatch next\n- Confluence Seal Actions Signed With an Authenticator Code: https://youtu.be/-eUE8Hsdiik\n- Confluence Page Approval: Draft to Approved, Enforced: https://youtu.be/SoYsOGB3J5Q\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #DataClassification", "tags": "Confluence classification, Confluence data classification, Confluence confidential, Confluence sensitivity labels, Confluence compliance, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence governance, information security", "thumb": "thumbnails/sentinel-vault-thumb-classification.png", "id": "taEynzBs3ew"};
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