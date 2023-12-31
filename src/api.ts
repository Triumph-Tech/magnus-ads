import fetch from "node-fetch";
import { ObjectExplorerNodesRequestBag, ObjectExplorerNodesResponseBag, ExecuteQueryRequest, ObjectExplorerNodeBag, ConnectResponseBag, GetColumnNamesRequestBag, GetColumnNamesResponseBag, ExecuteQueryProgress, QueryMessage } from "./types";
import { AbortSignal } from "abort-controller";

function getDefaultError(data: unknown): Error {
    if (!data || typeof data !== "object") {
        return new Error("Unable to complete request.");
    }

    const errorData = data as Record<string, string>;

    if (errorData.exceptionMessage) {
        return new Error(errorData.exceptionMessage);
    }
    else if (errorData.message) {
        return new Error(errorData.message);
    }
    else {
        return new Error("Request failed but did not provide a reason.");
    }

}

/**
 * A special reviver method for JSON.parse that forces any object keys to be
 * camel case.
 *
 * @param _key The key related to the value we are currently reviving.
 * @param value The value currently being revived.
 *
 * @returns The value.
 */
function toCamelCaseReviver(_key: string, value: unknown): unknown {
    if (value && typeof value === "object") {
        const valueObject = value as Record<string, unknown>;

        for (const valueKey in valueObject) {
            if (/^[A-Z]/.test(valueKey) && Object.hasOwnProperty.call(valueObject, valueKey)) {
                valueObject[valueKey.charAt(0).toLocaleLowerCase() + valueKey.substring(1)] = valueObject[valueKey];
                delete valueObject[valueKey];
            }
        }
    }

    return value;
}

/**
 * Special JSON.parse method that forces all objects to conform to camel case.
 *
 * @param json the JSON data to parse.
 *
 * @returns The object that was parsed.
 */
function jsonParse<T>(json: string | Buffer): T {
    if (typeof json === "string") {
        return JSON.parse(json, toCamelCaseReviver) as T;
    }
    else {
        const raw = json.toString("utf-8");
        return JSON.parse(raw, toCamelCaseReviver) as T;
    }
}

/**
 * Handles communication with the Rock server's API endpoints.
 */
export class Api {
    // #region Properties

    private baseUrl: string;
    private authCookie: string;
    
    public readonly serverDetails: ConnectResponseBag;

    // #endregion

    /**
     * Creates an instance of {@link Api}.
     * 
     * @param hostname The hostname or base URL to use when connecting to the server.
     * @param authCookie The authorization cookie returned by the login process.
     * @param connectBag The details about the server.
     */
    private constructor(hostname: string, authCookie: string, connectBag: ConnectResponseBag) {
        this.authCookie = authCookie;
        this.serverDetails = connectBag;

        if (hostname.includes("://")) {
            this.baseUrl = hostname;
        }
        else {
            this.baseUrl = `https://${hostname}`;
        }
    }

    // #region Functions

    /**
     * Initiates a new connection to the server.
     * 
     * @param hostname The hostname or base URL to use when connecting to the server.
     * @param username The username to authenticate with.
     * @param password The password to authenticate with.
     * 
     * @returns An instance of {@link Api} that can be used to communicate with the server.
     */
    public static async connect(hostname: string, username: string, password: string): Promise<Api> {
        let baseUrl = hostname.includes("://") ? hostname : `https://${hostname}`;
        const loginUrl = `${baseUrl}/api/Auth/Login`;

        const response = await fetch(loginUrl, {
            method: "post",
            timeout: 30000,
            body: JSON.stringify({
                username,
                password
            }),
            headers: {
                "Content-Type": "application/json"
            }
        });

        if (response.status === 401) {
            throw new Error("Invalid username or password.");
        }
        else if (response.status !== 200 && response.status !== 204) {
            throw new Error("Unable to login, unknown error occurred.");
        }

        if (!response.headers.has("set-cookie")) {
            throw new Error("Invalid response received from the server.");
        }

        const setCookieKey = Object.keys(response.headers.raw()).find(k => k.toLowerCase() === "set-cookie");
        const cookie = setCookieKey
            ? response.headers.raw()[setCookieKey].find(c => c.startsWith(".ROCK="))
            : undefined;

        if (!cookie) {
            throw new Error("Invalid response received from the server.");
        }

        const authCookie = cookie.split(";")[0];

        const connectUrl = `${baseUrl}/api/TriumphTech/Magnus/Sql/Connect`;
        const connectResponse = await fetch(connectUrl, {
            method: "post",
            body: JSON.stringify({}),
            timeout: 30000,
            headers: {
                "Content-Type": "application/json",
                "Cookie": authCookie
            }
        });

        if (connectResponse.status === 200) {
            const data = jsonParse<ConnectResponseBag>(await connectResponse.buffer());
            return new Api(hostname, authCookie, data);
        }
        else {
            throw new Error("Unable to negotiate connection with the server.");
        }
    }

    /**
     * Executes a SQL query against the Rock database.
     * 
     * @param queryText The SQL query text to be executed.
     * 
     * @returns The results of the query.
     */
    public async executeQuery(queryText: string, messageCallback: (data: QueryMessage) => void, abort?: AbortSignal): Promise<ExecuteQueryProgress> {
        let url = `${this.baseUrl}/api/TriumphTech/Magnus/Sql/ExecuteQuery`;
        let identifier: string;
        let aborted = false;
        const data: ExecuteQueryRequest = {
            query: queryText
        };

        abort?.addEventListener("abort", () => {
            aborted = true;

            if (identifier) {
                fetch(`${this.baseUrl}/api/TriumphTech/Magnus/Sql/Cancel/${identifier}`, {
                    method: "delete",
                    headers: {
                        "Cookie": this.authCookie
                    }
                });
            }
        });

        let result = await fetch(url, {
            method: "post",
            body: JSON.stringify(data),
            headers: {
                "Content-Type": "application/json",
                "Cookie": this.authCookie
            }
        });

        if (result.status !== 200) {
            throw getDefaultError(jsonParse(await result.buffer()));
        }

        let progress = jsonParse<ExecuteQueryProgress>(await result.buffer());

        identifier = progress.identifier;
        url = `${this.baseUrl}/api/TriumphTech/Magnus/Sql/Status/${identifier}`;

        // Check for completed.
        while (!progress.isComplete) {
            for (const msg of progress.messages) {
                messageCallback(msg);
            }

            result = await fetch(url, {
                method: "get",
                headers: {
                    "Cookie": this.authCookie
                }
            });

            if (result.status !== 200) {
                throw getDefaultError(jsonParse(await result.buffer()));
            }
    
            progress = jsonParse<ExecuteQueryProgress>(await result.buffer());
        }

        return progress;
    }

    /**
     * Gets the child nodes of the given parent.
     * 
     * @param nodeId The identifier of the parent node whose children are requested.
     * 
     * @returns An array of node bags that describe the child nodes.
     */
    public async getChildNodes(nodeId: string | undefined): Promise<ObjectExplorerNodeBag[]> {
        const url = `${this.baseUrl}/api/TriumphTech/Magnus/Sql/ObjectExplorerNodes`;
        const data: ObjectExplorerNodesRequestBag = {
            nodeId
        };

        const result = await fetch(url, {
            method: "post",
            body: JSON.stringify(data),
            timeout: 30000,
            headers: {
                "Content-Type": "application/json",
                "Cookie": this.authCookie
            }
        });

        if (result.status === 200) {
            const data = jsonParse<ObjectExplorerNodesResponseBag>(await result.buffer());
            return data.nodes;
        }
        else {
            throw getDefaultError(jsonParse(await result.buffer()));
        }
    }

    /**
     * Gets the names of the columns for the table.
     * 
     * @param table The name of the table whose column names are requested.
     * 
     * @returns An array of column names.
     */
    public async getColumnNames(table: string): Promise<string[]> {
        const url = `${this.baseUrl}/api/TriumphTech/Magnus/Sql/ColumnNames`;
        const data: GetColumnNamesRequestBag = {
            tableName: table
        };

        const result = await fetch(url, {
            method: "post",
            body: JSON.stringify(data),
            timeout: 30000,
            headers: {
                "Content-Type": "application/json",
                "Cookie": this.authCookie
            }
        });

        if (result.status === 200) {
            const data = jsonParse<GetColumnNamesResponseBag>(await result.buffer());
            return data.columns;
        }
        else {
            throw getDefaultError(jsonParse(await result.buffer()));
        }
    }

    // #endregion
}
