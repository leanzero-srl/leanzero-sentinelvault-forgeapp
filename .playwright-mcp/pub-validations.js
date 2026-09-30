async (page) => {
  const v = {"file": "sentinel-vault-validations.mp4", "key": "validations", "title": "Confluence Content Rules: Require Headings and Labels", "desc": "Require a heading or a label on Confluence pages. Sentinel Vault checks the page, lists what is missing, and passes once it is fixed.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nContent standards are easy to write down and hard to keep. In the space settings Validations tab we pick the enforcement (flag with a comment, mark pass or fail status, or revert non-compliant edits) and add a Require a heading rule named Demo. The panel re-checks the page and reports Issues found: a heading containing Demo is missing. After adding that heading in the editor and re-checking, the result is Passed. Then the same thing at site level: a Require labels rule for the label test. The page fails with Missing required label, the label is added through Confluence's Add labels dialog, and the re-check passes.\n\nWhat you will learn\n- Space and site validation rules and the three enforcement modes\n- Reading Issues found on the page\n- Fixing the page and re-checking until all checks pass\n\nChapters\n00:00 Intro\n00:11 Add a Require a heading rule\n00:31 The page is checked\n00:43 Add the heading in the editor\n01:03 Re-check the page\n01:19 Site settings: a site-wide rule\n01:31 Label test is required\n01:47 Add the label\n02:03 Re-check: passed\n\nWatch next\n- Confluence Page Approval: Draft to Approved, Enforced: https://youtu.be/SoYsOGB3J5Q\n- Confluence Admin: Force Release, Trash and Restore Settings: https://youtu.be/XYvwHigjkFg\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #Governance", "tags": "Confluence content validation, Confluence page template rules, Confluence required labels, Confluence governance, Confluence quality, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence admin, documentation standards", "thumb": "thumbnails/sentinel-vault-thumb-validations.png", "id": "aBFt6A9_8Oo"};
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