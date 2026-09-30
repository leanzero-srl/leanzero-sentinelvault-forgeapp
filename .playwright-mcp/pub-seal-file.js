async (page) => {
  const v = {"file": "sentinel-vault-seal-file.mp4", "key": "seal-file", "title": "Confluence Attachment Lock: Seal a File in One Click", "desc": "Lock a Confluence attachment in one click: add the Sentinel Vault panel to a page, seal a file, and your colleagues see it as sealed.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nConfluence tracks who changed a file; it does not stop the change. In this tutorial two people work on the same page side by side. Gabriela edits the page, types /senti and inserts the Sentinel Vault panel under a heading. After publishing, the panel lists every attachment on the page, grouped into sealed and available files, with sealed sections and an activity log underneath. She clicks Seal on image (4).png and the card flips to Sealed by you. On Mihai's screen the same file now sits under Sealed by others with a Request edit button instead of an edit path.\n\nWhat you will learn\n- How to add the Sentinel Vault panel to a Confluence page\n- How to seal an attachment from its card\n- What a colleague sees on a file you have sealed\n\nChapters\n00:00 Intro\n00:19 Publish the page\n00:31 Click Seal on image (4).png\n\nWatch next\n- Confluence Edit Requests: Approve or Decline Sealed Files: https://youtu.be/TyW_js0qXbs\n- Confluence Attachment Overwritten? Sealed Files Revert: https://youtu.be/8YFcmh_-MJg\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #DocumentControl", "tags": "Confluence attachment lock, lock file Confluence, Confluence file protection, Confluence attachments, Confluence Cloud, Atlassian Forge app, Sentinel Vault, Confluence admin tutorial, document control Confluence, Atlassian Marketplace", "thumb": "thumbnails/sentinel-vault-thumb-seal-file.png", "id": "BFDpA4Y1Tgk"};
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