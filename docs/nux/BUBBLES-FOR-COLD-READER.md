
## Tour site
1. [Hi! I'm Elzi.] I'm Sentinel Vault's guide. I'll show you around quickly.
2. [This is Sentinel Vault] Sentinel Vault protects files and sections on Confluence pages. When someone seals a file, nobody else can change it until it's released or the seal runs out. If someone does, their change is undone and they're told. You set the rules for the whole site here.
3. [Site settings] These switches apply to every space: how long a seal lasts, who is told, what people may do from a page. A space admin can adjust some of them for one space. Changes only count once you press Apply.
4. [See this again] This button opens the tour again any time. Each tab also has its own Tour button.

## Tour space
1. [Hi! I'm Elzi.] I'm Sentinel Vault's guide. I'll show you around quickly.
2. [Sentinel Vault in this space] This is where you look after sealed files in this space. A seal keeps a file safe from other people's edits until it's released or runs out.
3. [Every sealed file] Every sealed file in the space is listed here. If an owner is away and a file is stuck, you can release their seal. You'll be asked for a reason, and it's recorded.
4. [Who manages this space] Add people or groups as Sentinel Vault admins for this space, approve requests for access, and set the space to Quiet so it posts no comments.
5. [See this again] This button opens the tour again any time. Each tab also has its own Tour button.

## Tour space
1. [Hi! I'm Elzi.] I'm Sentinel Vault's guide. I'll show you around quickly.
2. [Sentinel Vault in this space] This is where you look after sealed files in this space. A seal keeps a file safe from other people's edits until it's released or runs out.
3. [Your sealed files] These are the files you have sealed in this space, and the edit requests you have made. To manage everyone's seals, ask a space admin for access.
4. [See this again] This button opens the tour again any time. Each tab also has its own Tour button.

## Tour site-settings
1. [Protection] This group decides what gets protected and who may step in. If someone removes a sealed image from a page, Sentinel Vault can put it back. Space admins can release a seal that'sn't theirs, with a reason that's recorded.
2. [How long a seal lasts] A seal holds a file for a set time, 48 hours unless you change it. Before it runs out, the owner gets a few reminders. You can also turn expiry off, and then a seal lasts until someone releases it.
3. [Who hears about it] Pop-ups and the page ribbon always work. Page comments that mention people are off by default, so nobody gets a surprise notification. Turn them on here if you want editors told when their change was undone.

## Tour site-validations
1. [Content rules] A validation checks a page each time it's saved. You might ask for a heading, add a table requirement, or cap the length. Confluence can't stop a save, so the check runs right after it.
2. [What happens to a page that fails] Advisory leaves a comment listing what's missing. Gate marks the page passed or failed. Revert puts back the last good version, which can throw away someone's work, so choose it on purpose.
3. [AI review] An AI can also read a page against your own instructions. It runs on Atlassian's own AI, so nothing leaves Atlassian. It's off until you turn it on, and a monthly allowance for the whole site caps what it can use.

## Tour site-classification
1. [Page levels] Classification shows a level, like Public or Confidential, under every page title. It starts off. Turning it off later keeps every level and default, so nothing is lost.
2. [The levels] Each level has a rank, and rank 1 is the least sensitive. Rename them, change their colour, add your own, or import them from Jira Service Management Assets. Or use your site's own Confluence levels instead.
3. [A default per space] A space can have a default level, so its pages start there. A page's own level wins over its space's. Lowering a level always asks for a reason, and the reason goes in the activity log.

## Tour site-api
1. [Do it by script] Anything you set up here can also be done by script over REST, like sending settings, sealing files or running checks. It's one endpoint, and it follows the same permissions as the screen.
2. [Tokens] A token lets a script call that endpoint as you. Its role limits it. A Viewer changes nothing, an Editor handles content, and an Admin handles everything. A token shows up once, so copy it when you make it.
3. [Recent jobs] Every request leaves a receipt. This list shows the latest ones, so you can see what a script did and whether it worked.

## Tour site-backup
1. [Your backup] Sentinel Vault saves your setup after each change and once a day, to a Confluence page in a space you pick. If the app is ever removed, your settings are not lost.
2. [Restoring] A restore shows you what comes back before it changes anything. Things that act on their own, like automations, come back paused, so nothing fires by surprise.
3. [Export and import] You can also export the whole setup as one file and import it later, for example to copy it to another site. Keep a copy somewhere safe.

## Tour space-my-claims
1. [Your sealed files] Here are the files you have sealed in this space, and the edit requests you have made. A seal is yours until you release it or it runs out. After that the file is open to everyone again.
2. [Want more control?] If you look after this space, ask for admin access. A space admin approves it. If it's declined, you can ask again after 48 hours.

## Tour space-locked-attachments
1. [Sealed files] A seal locks a file so only its owner can change it, until it's released or runs out. If someone uploads a new version anyway, Sentinel Vault puts the sealed one back, and their version stays in the file's history.
2. [When the owner is away] Pick the columns you want and sort the list here. If an owner is away, a row's Force release frees the file. You type a reason and it's recorded. It only shows while the site allows space admins to do it.

## Tour space-permissions
1. [Quiet mode] Normally Sentinel Vault posts a comment on the page that mentions the people involved. Set the space to Quiet and it posts none and mentions nobody. Pop-ups, the page ribbon and the activity log keep working.
2. [Space admins] Add people or whole groups as Sentinel Vault admins here. They can see every seal in this space and manage it. Requests for access wait in the next card for you to approve or deny.
3. [Classification here] If the site has classification on, you can switch it off for just this space, or pick a default level for its pages. Lowering that default asks for a reason.

## Tour space-unlock-timeouts
1. [How long seals last here] New seals follow the site's duration unless you set your own. Untick the box to give this space a duration in hours. A shorter time suits files that change often, a longer one suits slow reviews.
2. [When time runs out] The owner gets reminders first, and then the file is released. The reminders and the release follow the site settings, so you only choose how long a seal holds.

## Tour space-macro-settings
1. [The panel on pages] The Sentinel Vault panel lists a page's files as Sealed or Available, with Seal and Release buttons. It can be added to a page the first time someone seals a file. A site admin holds the main switch. Here you choose to allow it in this space, and put it at the top or bottom.

## Tour space-validations
1. [Rules for this space] These checks run on pages in this space each time one is saved. Leave the list empty and the space follows the site's rules. Add your own and they replace the site's advisory rules. A rule the site marks required always applies.
2. [What happens to a page that fails] Advisory leaves a comment, Gate marks the page passed or failed, and Revert puts back the last good version. A space can switch a way on. It can't switch off one the site turned on.
3. [Add a rule] Press Add rule, pick a type such as a required heading or table, give it a label, and say whether it's advisory or required. Then save.

## Tour space-workflow
1. [Approval workflow] With the workflow on, each page carries a state, such as Draft or In Review, and it shows on the page ribbon. Approved pages are protected, and you choose what happens when someone edits one.
2. [Who approves] Name the people or groups who can approve, and how many of them must say yes. Space admins can approve too. You can ask approvers to sign each decision with an authenticator code.
   (on the Workflow tab itself, where the approval settings are not shown, pointing at the "Edit the states, approvers and protection" button) This button opens the page where you set approvers. There you name the people or groups who can approve and how many must say yes. Space admins can approve too.

## Tour space-activity
1. [The activity log] Every seal, release, edit request, approval and classification change in this space is recorded here, with who did it and when. If someone asks why a file was released, the answer is in this list.
2. [Filter and export] Narrow the list by period or by type of event, load more as you go, and export it to a CSV file for an audit.
