import { Axios, AxiosRequestConfig, Method } from "axios";
import { ObjectExplorerNodesRequestBag, ObjectExplorerNodesResponseBag, ExecuteQueryRequest, ExecuteQueryResult, ObjectExplorerNodeBag, ConnectResponseBag } from "./types";

const axios = new Axios({
    headers: {
        "Content-Type": "application/json"
    },
    timeout: 1 * 60 * 60 * 1000, // 1 hour
    transformResponse: (data: unknown): unknown => {
        if (typeof data === "string" && data !== "") {
            try {
                return jsonParse(data);
            }
            catch {
                return data;
            }
        }

        return data;
    }
});

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
function jsonParse<T>(json: string): T {
    return JSON.parse(json, toCamelCaseReviver) as T;
}

export class Api {
    private baseUrl: string;
    private authCookie: string;
    
    public readonly serverDetails: ConnectResponseBag;

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

    public static async connect(hostname: string, username: string, password: string): Promise<Api> {
        let baseUrl = hostname.includes("://") ? hostname : `https://${hostname}`;
        const loginUrl = `${baseUrl}/api/Auth/Login`;

        const response = await axios.post(loginUrl, JSON.stringify({
            username,
            password
        }));

        if (response.status === 401) {
            throw new Error("Invalid username or password.");
        }
        else if (response.status !== 200 && response.status !== 204) {
            throw new Error("Unable to login, unknown error occurred.");
        }

        if (!response.headers["set-cookie"]) {
            throw new Error("Invalid response received from the server.");
        }

        const cookie = response.headers["set-cookie"].find(c => c.startsWith(".ROCK="));

        if (!cookie) {
            throw new Error("Invalid response received from the server.");
        }

        const authCookie = cookie.split(";")[0];

        const connectUrl = `${baseUrl}/api/TriumphTech/Magnus/Sql/Connect`;
        const connectResponse = await axios.post<ConnectResponseBag>(connectUrl, JSON.stringify({}), {
            headers: {
                "Cookie": authCookie
            }
        });

        if (connectResponse.status === 200) {
            return new Api(hostname, authCookie, connectResponse.data);
        }
        else {
            throw new Error("Unable to negotiate connection with the server.");
        }
    }

    public async executeQuery(queryText: string): Promise<ExecuteQueryResult> {
        const url = `${this.baseUrl}/api/TriumphTech/Magnus/Sql/ExecuteQuery`;
        const data: ExecuteQueryRequest = {
            query: queryText
        };

        const result = await axios.post<ExecuteQueryResult>(url, JSON.stringify(data), {
            headers: {
                "Cookie": this.authCookie
            }
        });

        if (result.status === 200) {
            return result.data;
        }
        else {
            throw getDefaultError(result.data);
        }
    }

    public async getChildNodes(nodeId: string | undefined): Promise<ObjectExplorerNodeBag[]> {
        const url = `${this.baseUrl}/api/TriumphTech/Magnus/Sql/ObjectExplorerNodes`;
        const data: ObjectExplorerNodesRequestBag = {
            nodeId
        };

        const result = await axios.post<ObjectExplorerNodesResponseBag>(url, JSON.stringify(data), {
            headers: {
                "Cookie": this.authCookie
            }
        });

        if (result.status === 200) {
            return result.data.nodes;
        }
        else {
            throw getDefaultError(result.data);
        }
    }
}
