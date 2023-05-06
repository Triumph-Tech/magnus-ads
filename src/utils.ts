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
