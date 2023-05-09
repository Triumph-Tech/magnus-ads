import { QueryColumnType } from "./types";

/**
 * Most parts of Azure Data Studio we are dealing with are expecting to
 * talk to a remote language server. It has expectations of some delays
 * for every call. Because of that, there are some bugs where sometimes
 * the "response listener" isn't created until after the command function
 * returns. But we have already sent the response in some cases because
 * we don't need to talk to a remote language server. This tricks ADS
 * into thinking that is happening by introducing a short delay.
 * 
 * @param callback The callback function to execute.
 */
export function runClientRequest(callback: (() => void | Promise<void>)) {
    setTimeout(callback, 10);
}

/**
 * Gets a string that represents the duration of the milliseconds.
 * 
 * @param totalMilliseconds The milliseconds to be converted to a time string.
 * 
 * @returns A string that represents the duration.
 */
export function toElapsedString(totalMilliseconds: number): string {
    const hours = Math.floor(totalMilliseconds / (1000 * 60 * 60));
    totalMilliseconds = totalMilliseconds % (1000 * 60 * 60);

    const minutes = Math.floor(totalMilliseconds / (1000 * 60));
    totalMilliseconds = totalMilliseconds % (1000 * 60);

    const seconds = Math.floor(totalMilliseconds / 1000);
    const milliseconds = totalMilliseconds % 1000;

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

/**
 * Gets the value that should be displayed for the given data type and value.
 * 
 * @param type The type of column this value came from.
 * @param value The raw value from the query results.
 * 
 * @returns A string that represents the value.
 */
export function getCellDisplayValue(type: QueryColumnType, value: unknown): string {
    if (value === undefined || value === null) {
        return "null";
    }

    switch (type) {
        case QueryColumnType.String:
        case QueryColumnType.Number:
        case QueryColumnType.ByteArray:
        case QueryColumnType.Unknown:
            return String(value);
        
        case QueryColumnType.Boolean:
            return value ? "1" : "0";
        
        case QueryColumnType.DateTime:
            return getDateDisplayFormat(new Date(Date.parse(String(value))));
    }
}

/**
 * Gets the date in a standard format for display.
 * 
 * @param date The date object to be formatted.
 * 
 * @returns A string that represents the date in a standard format for display in ADS.
 */
export function getDateDisplayFormat(date: Date): string {
    const year = date.getFullYear().toString().padStart(4, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const hour = date.getHours().toString().padStart(2, "0");
    const minute = date.getMinutes().toString().padStart(2, "0");
    const second = date.getSeconds().toString().padStart(2, "0");
    const millis = date.getMilliseconds().toString().padStart(3, "0");

    return `${year}-${month}-${day} ${hour}:${minute}:${second}.${millis}`;
}
