import * as azdata from "azdata";

/**
 * This class needs to exist for server properties to be supported.
 */
export class AdminServicesProvider implements azdata.AdminServicesProvider {
    public handle?: number | undefined;
    public get providerId(): string {
        return "magnus";
    };

    createDatabase(connectionUri: string, database: azdata.DatabaseInfo): Thenable<azdata.CreateDatabaseResponse> {
        throw new Error('Method not implemented.');
    }

    createLogin(connectionUri: string, login: azdata.LoginInfo): Thenable<azdata.CreateLoginResponse> {
        throw new Error('Method not implemented.');
    }

    getDefaultDatabaseInfo(connectionUri: string): Thenable<azdata.DatabaseInfo> {
        // This information provides the properties when looking at a single
        // database in the dashboard. But we don't have anything to show.
        return Promise.resolve({
            options: {}
        });
    }

    getDatabaseInfo(connectionUri: string): Thenable<azdata.DatabaseInfo> {
        return this.getDefaultDatabaseInfo(connectionUri);
    }
}
