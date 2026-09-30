async (page) => {
  const v = {"file": "sentinel-vault-sealed-sections.mp4", "key": "sealed-sections", "title": "Confluence Section Lock: Seal One Heading, Edit the Rest", "desc": "Lock one section of a Confluence page and keep the rest editable. Edits by others are undone until the owner approves them.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nSometimes only part of a page must not change. Gabriela opens Seal a section in the Sentinel Vault panel, picks the heading 1. Introduction and seals it for one day. The seal covers the heading and the blocks under it; the rest of the page stays open. Mihai then edits that section and publishes. Sentinel Vault reverts the page to the sealed version, Gabriela's ribbon says an edit to her section was reverted automatically, and Mihai is told his text is kept in the page history. He uses Request edit on the section instead, Gabriela approves, and his next edit under the seal is kept.\n\nWhat you will learn\n- Sealing a heading and everything under it, with a duration\n- What an unapproved edit to a sealed section looks like on both sides\n- Requesting and granting edit access to a section\n\nChapters\n00:00 Intro\n00:15 Click Seal a section\n00:27 Section sealed until tomorrow\n00:55 The edit is reverted\n01:09 Request edit on the section\n01:25 The owner approves\n01:37 Edit under the seal\n01:58 The approved edit stays\n\nWatch next\n- Confluence Edit Requests: Approve or Decline Sealed Files: https://youtu.be/TyW_js0qXbs\n- Confluence Page Approval: Draft to Approved, Enforced: https://youtu.be/SoYsOGB3J5Q\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #DocumentControl", "tags": "Confluence section lock, Confluence page protection, lock part of Confluence page, Confluence restrictions, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence governance, Confluence admin tutorial, document control", "thumb": "thumbnails/sentinel-vault-thumb-sealed-sections.png", "id": "I7VR1Cih9rg"};
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