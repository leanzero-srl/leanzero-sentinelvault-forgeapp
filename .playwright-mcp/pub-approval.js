async (page) => {
  const v = {"file": "sentinel-vault-approval.mp4", "key": "approval", "title": "Confluence Page Approval: Draft to Approved, Enforced", "desc": "Move a Confluence page from Draft to In Review to Approved. Once Approved, its sealed files and sections belong to the approval.\n\nGet Sentinel Vault on the Atlassian Marketplace: https://marketplace.atlassian.com/apps/1034857304/sentinel-vault?hosting=cloud\n\nHere is a document approval workflow from start to finish. From the page details, Gabriela moves the page from Draft to In Review, with validation already passed, and requests approval. Mihai gets an Approval requested comment and a toast, and decides right in the ribbon: any one approver can approve, and his approval is the deciding one. The page becomes Approved v50 with a review date. The sealed section now reads \"Locked by the approval of this page, expiry paused\", and the activity log explains that its sealed section and sealed file now belong to the approval. Unsealed text can still be edited normally. For a sealed file, Release is replaced by Propose a change, and the proposal waits for the approvers.\n\nWhat you will learn\n- Moving a page through Draft, In Review and Approved\n- Approving from the page ribbon\n- What happens to seals once a page is Approved\n\nChapters\n00:00 Intro\n00:11 Move to In Review\n00:28 The approver is notified\n00:40 Approve\n00:56 Seals now belong to the approval\n01:16 The activity explains it\n01:32 Unsealed text stays editable\n01:52 Propose a change to a sealed file\n02:04 Waiting for the approvers\n\nWatch next\n- Confluence Content Rules: Require Headings and Labels: https://youtu.be/aBFt6A9_8Oo\n- Confluence Section Lock: Seal One Heading, Edit the Rest: https://youtu.be/I7VR1Cih9rg\n- Sentinel Vault for Confluence: 8 Features in 5 Minutes: https://youtu.be/IGCvPP9RxZo\n\nResources\nProduct page and documentation: https://leanzero.net/portfolio/sentinel-vault\nUser guide: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp/blob/main/docs/user-guide.md\nSource code: https://github.com/leanzero-srl/leanzero-sentinelvault-forgeapp\n\nSentinel Vault runs entirely on Atlassian Forge, so your content never leaves Atlassian. Built by LeanZero.\n\n#Confluence #Atlassian #Compliance", "tags": "Confluence approval workflow, Confluence page approval, Confluence document approval, Confluence review workflow, Confluence governance, Confluence Cloud, Atlassian Forge, Sentinel Vault, document control, Confluence compliance", "thumb": "thumbnails/sentinel-vault-thumb-approval.png", "id": "SoYsOGB3J5Q"};
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