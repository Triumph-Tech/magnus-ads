import { ObjectExplorerContext } from "azdata";
import EventEmitter = require("events");
import * as vscode from "vscode";

enum EventName {
    SelectTop1000 = "selectTop1000"
};

/**
 * Handles commands from ADS and then dispatches them to listeners.
 */
export class Commands implements vscode.Disposable {
    // #region Private Properties

    private eventEmitter?: EventEmitter = new EventEmitter();

    // #endregion

    // #region Constructors

    /**
     * Creates a new instance of {@link Commands}.
     * 
     * @param context The context that provides information about the extension.
     */
    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.commands.registerCommand("magnus.selectTop1000", (...args) => this.emit(EventName.SelectTop1000, ...args)));
    }

    /** @inheritdoc */
    public dispose(): void {
        this.eventEmitter = undefined;
    }

    // #endregion

    // #region Functions

    /**
     * 
     * @param eventName The name of the event to be emitted.
     * @param args The arguments that should be sent to the event.
     */
    private emit(eventName: string, ...args: unknown[]): void {
        this.eventEmitter?.emit(eventName, ...args);
    }

    /**
     * Adds a listener for the Select Top 100 command.
     * 
     * @param listener The function that will be called in response to the event.
     */
    public onSelectTop1000(listener: ((context: ObjectExplorerContext) => void)): void {
        this.eventEmitter?.on(EventName.SelectTop1000, listener);
    }

    // #endregion
}