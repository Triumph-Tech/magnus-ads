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
