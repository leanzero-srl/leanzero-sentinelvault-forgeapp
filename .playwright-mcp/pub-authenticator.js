async (page) => {
  const v = {"file": "sentinel-vault-authenticator.mp4", "key": "authenticator", "title": "Confluence Seal Actions Signed With an Authenticator Code", "desc": "Require a 6-digit authenticator code before a Confluence seal action goes through. One site switch in Sentinel Vault.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nFor content where who did what matters, a click is not enough. With \"Sign seal actions with an authenticator code\" switched on in Sentinel Vault's site settings, a seal action on the page opens a Sign this action dialog. The user enters the current 6-digit code from their authenticator app, Sign and continue unlocks, the code is accepted and the panel refreshes with the action done. The last shot shows the site switch that turns this on, next to the other Protection settings.\n\nWhat you will learn\n- What the Sign this action dialog looks like\n- Entering the authenticator code to complete a seal action\n- Where the site switch lives\n\nChapters\n00:00 Intro\n00:11 The action asks for a code\n00:25 Code accepted\n\nWatch next\n- Confluence Admin: Force Release, Trash and Restore Settings: https://youtu.be/XYvwHigjkFg\n- Confluence Classification Levels: Set a Space Default: https://youtu.be/taEynzBs3ew\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #Security", "tags": "Confluence authenticator, Confluence two-step verification, Confluence e-signature, Confluence audit, Confluence compliance, Confluence Cloud, Atlassian Forge, Sentinel Vault, document control, Confluence security", "thumb": "thumbnails/sentinel-vault-thumb-authenticator.png", "id": "-eUE8Hsdiik"};
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