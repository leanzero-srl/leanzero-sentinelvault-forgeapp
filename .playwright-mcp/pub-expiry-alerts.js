async (page) => {
  const v = {"file": "sentinel-vault-expiry-alerts.mp4", "key": "expiry-alerts", "title": "Confluence Seal Expiry, Reminders and Alerts: Set Up", "desc": "Set how long Confluence seals last, when overdue reminders go out, and who is told what, then apply it all at once in Sentinel Vault.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nThe Expiry and Alerts sections of Sentinel Vault's site settings, in one pass. First the cooldown before a declined edit request can be repeated, then the default seal duration, set to 24 hours (shown as 1 day). Changes collect in a Not applied yet bar, so nothing takes effect until you press Apply. Seals expire is switched on, which enables overdue reminders (set to 3) and the hours between them. Under Alerts, pop-up messages and the page ribbon go on, then Tell editors when their change is undone, then Page comments that mention people, which unlocks the violation, confirmation and expiry notices. One Apply and all changes are applied.\n\nWhat you will learn\n- Default seal duration and expiry\n- Overdue reminders and the decline cooldown\n- Which alerts reach owners and editors\n\nChapters\n00:00 Intro\n00:19 Changes wait for Apply\n00:31 Turn on Seals expire\n00:47 Alerts\n00:59 Tell editors when a change is undone\n\nWatch next\n- Confluence Admin: Force Release, Trash and Restore Settings: https://youtu.be/XYvwHigjkFg\n- Confluence Seal Actions Signed With an Authenticator Code: https://youtu.be/-eUE8Hsdiik\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #ConfluenceAdmin", "tags": "Confluence notifications, Confluence reminders, Confluence admin settings, Confluence expiry, Confluence administration, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence governance, document control", "thumb": "thumbnails/sentinel-vault-thumb-expiry-alerts.png", "id": "qHFShA4mu3E"};
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