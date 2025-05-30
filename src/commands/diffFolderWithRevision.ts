import type { TextDocumentShowOptions, TextEditor } from 'vscode';
import { FileType, Uri, workspace } from 'vscode';
import { GlyphChars } from '../constants';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { openFolderCompare } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { shortenRevision } from '../git/utils/revision.utils';
import { showGenericErrorMessage } from '../messages';
import { showCommitPicker } from '../quickpicks/commitPicker';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { pad } from '../system/string';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';

export interface DiffFolderWithRevisionCommandArgs {
	uri?: Uri;
	ref1?: string;
	ref2?: string;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffFolderWithRevisionCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.diffFolderWithRevision');
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffFolderWithRevisionCommandArgs): Promise<any> {
		args = { ...args };
		uri = args?.uri ?? getCommandUri(uri, editor);
		if (uri == null) return;

		try {
			const stat = await workspace.fs.stat(uri);
			if (stat.type !== FileType.Directory) {
				uri = Uri.joinPath(uri, '..');
			}
		} catch {}

		const gitUri = await GitUri.fromUri(uri);

		try {
			const repoPath = (await getBestRepositoryOrShowPicker(uri, editor, `Open Folder Changes with Revision`))
				?.path;
			if (!repoPath) return;

			const commitsProvider = this.container.git.commits(repoPath);
			const log = commitsProvider
				.getLogForFile(gitUri.fsPath)
				.then(
					log => log ?? (gitUri.sha ? commitsProvider.getLogForFile(gitUri.fsPath, gitUri.sha) : undefined),
				);

			const relativePath = this.container.git.getRelativePath(uri, repoPath);
			const title = `Open Folder Changes with Revision${pad(GlyphChars.Dot, 2, 2)}${relativePath}${
				gitUri.sha ? ` at ${shortenRevision(gitUri.sha)}` : ''
			}`;
			const pick = await showCommitPicker(log, title, 'Choose a commit to compare with', {
				picked: gitUri.sha,
				showOtherReferences: [
					CommandQuickPickItem.fromCommand('Choose a Branch or Tag...', GlCommand.DiffFolderWithRevisionFrom),
				],
			});
			if (pick == null) return;

			void openFolderCompare(this.container, uri, { repoPath: repoPath, lhs: pick.ref, rhs: gitUri.sha ?? '' });
		} catch (ex) {
			Logger.error(ex, 'DiffFolderWithRevisionCommand');
			void showGenericErrorMessage('Unable to open comparison');
		}
	}
}
