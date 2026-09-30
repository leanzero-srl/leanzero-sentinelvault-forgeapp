async (page) => {
  const v = {"file": "sentinel-vault-edit-requests.mp4", "key": "edit-requests", "title": "Confluence Edit Requests: Approve or Decline Sealed Files", "desc": "Ask the owner of a sealed Confluence file for edit access, then approve, decline with a reason, or watch the file until it is released.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nA seal should not be a dead end. In this tutorial Mihai finds two files sealed by Gabriela and uses Request edit on both, with a short reason. Gabriela gets a comment and a toast, and each card shows Approve and Decline. She approves image (4).png, so Mihai is listed under Editors with access and his panel says Edit now with the time it lasts. She declines the other file with the word \"No\", and Mihai sees Declined, ask again at a set time, with her reason next to it. Then the roles flip: Mihai seals a file, Gabriela chooses Watch for release, and when Mihai releases it she gets a File Now Accessible notice.\n\nWhat you will learn\n- Requesting edit access to a sealed file, with a reason\n- Approving, declining and revoking access as the owner\n- Watching a sealed file so you know the moment it is free\n\nChapters\n00:00 Intro\n00:15 The owner is notified\n00:27 Approve image (4).png\n00:39 The requester can edit now\n00:59 Declined \u00b7 ask again later\n01:11 Mihai seals image (3).png\n01:31 Watch for release\n01:47 Released: File Now Accessible\n\nWatch next\n- Confluence Attachment Lock: Seal a File in One Click: https://youtu.be/BFDpA4Y1Tgk\n- Confluence Section Lock: Seal One Heading, Edit the Rest: https://youtu.be/I7VR1Cih9rg\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #Collaboration", "tags": "Confluence edit request, Confluence permissions, Confluence file locking, Confluence approval, Confluence collaboration, Confluence Cloud, Atlassian Forge, Sentinel Vault, Confluence attachments, document control", "thumb": "thumbnails/sentinel-vault-thumb-edit-requests.png", "id": "TyW_js0qXbs"};
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