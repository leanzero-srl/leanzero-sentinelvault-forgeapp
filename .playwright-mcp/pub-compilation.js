async (page) => {
  const v = {"file": "sentinel-vault-compilation.mp4", "key": "compilation", "title": "Sentinel Vault for Confluence: 8 Features in 5 Minutes", "desc": "Seal files and sections, answer edit requests, auto-revert overwrites, enforce approvals and classification in Confluence. Real recordings.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nSentinel Vault is document control for Confluence. This compilation walks through eight features in short chapters, each cut from the same real recordings as the full tutorials: sealing an attachment from the page panel, approving and declining edit requests, an overwritten file reverted automatically, sealing one section of a page, content rules that check headings, a page moving from In Review to Approved, seal actions signed with an authenticator code, and classification levels with a space default. Each chapter links to its full tutorial below.\n\nWhat you will learn\n- What each Sentinel Vault feature does on a real page\n- How owners, editors and approvers each see it\n- Where admins switch features on\n\nChapters\n00:00 Sealed files\n00:26 Edit requests\n01:09 Auto-restore\n01:46 Sealed sections\n02:27 Content validation\n02:53 Approval workflow\n03:27 Authenticator\n03:49 Classification\n\nWatch next\n- Confluence Attachment Lock: Seal a File in One Click: https://youtu.be/BFDpA4Y1Tgk\n- Confluence Edit Requests: Approve or Decline Sealed Files: https://youtu.be/TyW_js0qXbs\n- Confluence Attachment Overwritten? Sealed Files Revert: https://youtu.be/8YFcmh_-MJg\n- Confluence Section Lock: Seal One Heading, Edit the Rest: https://youtu.be/I7VR1Cih9rg\n- Confluence Content Rules: Require Headings and Labels: https://youtu.be/aBFt6A9_8Oo\n- Confluence Page Approval: Draft to Approved, Enforced: https://youtu.be/SoYsOGB3J5Q\n- Confluence Seal Actions Signed With an Authenticator Code: https://youtu.be/-eUE8Hsdiik\n- Confluence Classification Levels: Set a Space Default: https://youtu.be/taEynzBs3ew\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #DocumentControl", "tags": "Confluence document control, Confluence file lock, Confluence approval workflow, Confluence classification, Confluence governance, Confluence Cloud, Atlassian Marketplace app, Atlassian Forge, Sentinel Vault, LeanZero, Confluence compliance", "thumb": "thumbnails/sentinel-vault-thumb-compilation.png", "id": "IGCvPP9RxZo"};
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