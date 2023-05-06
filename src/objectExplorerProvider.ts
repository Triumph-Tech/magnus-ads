import * as azdata from "azdata";
import * as vscode from "vscode";
import { Api } from "./api";
import { ObjectExplorerNodeBag, ObjectExplorerNodeType } from "./types";
import { ConnectionProvider } from "./connectionProvider";
import { v4 } from "uuid";
import { runClientRequest } from "./utils";
import { Commands } from "./commands";

/**
 * Gets the icon that will be used to represent this item in the tree.
 * 
 * @param nodeBag The node bag that was received from the server.
 * 
 * @returns The icon to use that will represent this item in the tree.
 */
function getObjectExplorerNodeIcon(nodeBag: ObjectExplorerNodeBag): azdata.SqlThemeIcon | undefined {
    switch (nodeBag.type) {
        case ObjectExplorerNodeType.DatabasesFolder:
        case ObjectExplorerNodeType.TablesFolder:
        case ObjectExplorerNodeType.ColumnsFolder:
            return azdata.SqlThemeIcon.Folder;

        case ObjectExplorerNodeType.Database:
            return azdata.SqlThemeIcon.Database;

        case ObjectExplorerNodeType.Table:
            return azdata.SqlThemeIcon.Table;

        case ObjectExplorerNodeType.Column:
            return azdata.SqlThemeIcon.Column;

        default:
            return undefined;
    }
}

/**
 * Gets a value indicating if this node can have child nodes.
 * 
 * @param nodeBag The node bag that was received from the server.
 * 
 * @returns `true` if this item cannot have children; otherwise `false`.
 */
function getObjectExplorerNodeIsLeaf(nodeBag: ObjectExplorerNodeBag): boolean {
    switch (nodeBag.type) {
        case ObjectExplorerNodeType.DatabasesFolder:
        case ObjectExplorerNodeType.TablesFolder:
        case ObjectExplorerNodeType.Database:
        case ObjectExplorerNodeType.Table:
        case ObjectExplorerNodeType.ColumnsFolder:
            return false;

        default:
            return true;
    }
}

/**
 * Gets the native node information object that will represent the node.
 * 
 * @param nodeBag The node bag received from the server.
 * 
 * @returns The native node information object representing the node.
 */
function getObjectExplorerNodeInfo(nodeBag: ObjectExplorerNodeBag): azdata.NodeInfo {
    return {
        nodePath: nodeBag.id,
        nodeType: nodeBag.type.toString(),
        label: nodeBag.name,
        icon: getObjectExplorerNodeIcon(nodeBag),
        isLeaf: getObjectExplorerNodeIsLeaf(nodeBag)
    };
}

/**
 * The provider for the Object Explorer tree.
 */
export class ObjectExplorerProvider implements azdata.ObjectExplorerProvider {
    // #region Properties

    handle?: number | undefined;
    public readonly providerId: string = "magnus";

    private connectionProvider: ConnectionProvider;

    private readonly sessions: Record<string, Api> = {};

    private onSessionCreatedEmitter: vscode.EventEmitter<azdata.ObjectExplorerSession> = new vscode.EventEmitter();
    private onSessionCreated: vscode.Event<azdata.ObjectExplorerSession> = this.onSessionCreatedEmitter.event;

    private readonly onExpandCompletedEmitter = new vscode.EventEmitter<azdata.ObjectExplorerExpandInfo>();
    private readonly onExpandCompleted = this.onExpandCompletedEmitter.event;

    // #endregion

    /**
     * Creates a new instance of {@link ObjectExplorerProvider}.
     * 
     * @param connectionProvider The connection provider that will be used to look up connections.
     * 
     * @param commands The commands object that handles listening for commands from the individual.
     */
    constructor(connectionProvider: ConnectionProvider, commands: Commands) {
        this.connectionProvider = connectionProvider;

        commands.onSelectTop1000(ctx => this.onSelectTop1000(ctx));
    }

    // #region ObjectExplorerProvider Implementation.

    public async createNewSession(connectionInfo: azdata.ConnectionInfo): Promise<azdata.ObjectExplorerSessionResponse> {
        const api = await Api.connect(connectionInfo.options.server, connectionInfo.options.user, connectionInfo.options.password);

        if (!api) {
            throw new Error("Unable to locate server connection.");
        }

        // Get the API from the connectionUri like we do in query.
        const sessionId = v4();

        this.sessions[sessionId] = api;

        runClientRequest(() => {
            // Call API to get details...
            this.onSessionCreatedEmitter.fire({
                success: true,
                sessionId,
                rootNode: {
                    nodePath: "",
                    nodeType: "",
                    label: "Rock Server",
                    isLeaf: false
                }
            });
        });

        return {
            sessionId: sessionId
        };
    }

    public closeSession(closeSessionInfo: azdata.ObjectExplorerCloseSessionInfo): Thenable<azdata.ObjectExplorerCloseSessionResponse> {
        if (!closeSessionInfo.sessionId) {
            throw new Error("Invalid call");
        }

        delete this.sessions[closeSessionInfo.sessionId];

        return Promise.resolve<azdata.ObjectExplorerCloseSessionResponse>({
            sessionId: closeSessionInfo.sessionId!,
            success: true
        });
    }

    public async expandNode(nodeInfo: azdata.ExpandNodeInfo): Promise<boolean> {
        if (!nodeInfo.sessionId || !this.sessions[nodeInfo.sessionId]) {
            return Promise.resolve(false);
        }

        const api = this.sessions[nodeInfo.sessionId];

        runClientRequest(async () => {
            try {
                const children = await api.getChildNodes(nodeInfo.nodePath ? nodeInfo.nodePath : undefined);

                this.onExpandCompletedEmitter.fire({
                    sessionId: nodeInfo.sessionId,
                    nodePath: nodeInfo.nodePath ?? "",
                    nodes: children.map(n => getObjectExplorerNodeInfo(n))
                });
            } catch (error) {
                console.log(error);
                this.onExpandCompletedEmitter.fire({
                    sessionId: nodeInfo.sessionId,
                    nodePath: nodeInfo.nodePath ?? "",
                    nodes: [],
                    errorMessage: error instanceof Error ? error.message : String(error)
                });
            }
        });

        return Promise.resolve(true);
    }

    public refreshNode(nodeInfo: azdata.ExpandNodeInfo): Thenable<boolean> {
        return this.expandNode(nodeInfo);
    }

    public findNodes(findNodesInfo: azdata.FindNodesInfo): Thenable<azdata.ObjectExplorerFindNodesResponse> {
        throw new Error('Method not implemented.');
    }

    public registerOnSessionCreated(handler: (response: azdata.ObjectExplorerSession) => any): void {
        this.onSessionCreated(handler);
    }

    public registerOnExpandCompleted(handler: (response: azdata.ObjectExplorerExpandInfo) => any): void {
        this.onExpandCompleted(handler);
    }

    // #endregion

    // #region Functions

    /**
     * Event handler for when the individual activates the "Select top 1000"
     * contextual menu option on a table.
     * 
     * @param ctx The context describing the command initiated by the individual.
     */
    private async onSelectTop1000(ctx: azdata.ObjectExplorerContext): Promise<void> {
        const connectionProfile = ctx.connectionProfile;

        if (!connectionProfile || !ctx.nodeInfo) {
            return;
        }

        const conn = await azdata.connection.connect(connectionProfile, false, false);

        if (!conn.connectionId) {
            return;
        }

        const connectionUri = await azdata.connection.getUriForConnection(conn.connectionId);
        const api = this.connectionProvider.getConnectionApi(connectionUri);
        const columns = await api?.getColumnNames(ctx.nodeInfo.label);

        if (!columns || columns.length === 0) {
            return;
        }

        const document = await azdata.queryeditor.openQueryDocument({
            content: `SELECT TOP 1000
    [${columns.join("]\n    ,[")}]
FROM [${ctx.nodeInfo.label}]`
        }, connectionProfile?.providerName);

        if (conn.connected && conn.connectionId) {
            await azdata.queryeditor.connect(document.uri, conn.connectionId);
        }

        azdata.queryeditor.runQuery(document.uri, undefined, false);
    }

    // #endregion
}
