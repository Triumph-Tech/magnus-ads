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
    private username: string;
    private password: string;

    public constructor(hostname: string, username: string, password: string) {
        this.hostname = hostname;
        this.username = username;
        this.password = password;
    }

    public async executeQuery(queryText: string): Promise<ExecuteQueryResult> {
        const url = `https://${this.hostname}/api/sql/executeQuery`;
        const data: ExecuteQueryRequest = {
            query: queryText
        };

        const result = await axios.post<ExecuteQueryResult>(url, JSON.stringify(data));

        if (result.status === 200) {
            return result.data;
        }
        else {
            throw new Error("Request failed.");
        }
    }
}
