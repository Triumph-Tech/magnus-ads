import { Axios, AxiosRequestConfig, Method } from "axios";
import { ExecuteQueryRequest, ExecuteQueryResult } from "./types";

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
    private hostname: string;
    private authCookie: string;

    private constructor(hostname: string, authCookie: string) {
        this.hostname = hostname;
        this.authCookie = authCookie;
    }

    public static async connect(hostname: string, username: string, password: string): Promise<Api> {
        const loginUrl = `https://${hostname}/api/Auth/Login`;

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

        return new Api(hostname, authCookie);
    }

    public async executeQuery(queryText: string): Promise<ExecuteQueryResult> {
        const url = `https://${this.hostname}/api/TriumphTech/Magnus/Sql/ExecuteQuery`;
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
            throw new Error("Request failed.");
        }
    }
}
