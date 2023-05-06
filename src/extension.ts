import * as vscode from 'vscode';
import * as azdata from 'azdata';
import { Commands } from './commands';
import { ConnectionProvider } from './connectionProvider';
import { ObjectExplorerProvider } from './objectExplorerProvider';
import { QueryProvider } from './queryProvider';
import { MetadataProvider } from './metadataProvider';
import { CapabilitiesServiceProvider } from './capabilitiesServiceProvider';
import { AdminServicesProvider } from './adminServicesProvider';

export function activate(context: vscode.ExtensionContext) {
    const connectionProvider = new ConnectionProvider();
    const commands = new Commands(context);

    context.subscriptions.push(commands);
    context.subscriptions.push(azdata.dataprotocol.registerConnectionProvider(connectionProvider));
    context.subscriptions.push(azdata.dataprotocol.registerQueryProvider(new QueryProvider(connectionProvider)));
    context.subscriptions.push(azdata.dataprotocol.registerObjectExplorerProvider(new ObjectExplorerProvider(connectionProvider, commands)));
    context.subscriptions.push(azdata.dataprotocol.registerMetadataProvider(new MetadataProvider()));
    context.subscriptions.push(azdata.dataprotocol.registerCapabilitiesServiceProvider(new CapabilitiesServiceProvider()));
    context.subscriptions.push(azdata.dataprotocol.registerAdminServicesProvider(new AdminServicesProvider()));
    //context.subscriptions.push(vscode.languages.registerCompletionItemProvider("sql", new RockCompletionItemProvider(), ".", "-", ":", "\\", "[", "\""));
}

export function deactivate() {
}

// class RockCompletionItemProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
//     provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {
//         if (position.character !== 4) {
//             return [];
//         }

//         const item: vscode.CompletionItem = {
//             label: "DefinedType"
//         };

//         return [
//             {
//                 label: "DefinedType"
//             },
//             {
//                 label: "DefinedValue"
//             }
//         ];
//     }
//     resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
//         return item;
//     }

// }
