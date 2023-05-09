export enum QueryColumnType {
    Unknown = 0,

    String = 1,

    Number = 2,

    Boolean = 3,

    DateTime = 4,

    ByteArray = 5
}

export type ExecuteQueryRequest = {
    query: string;
};

export type ExecuteQueryResult = {
    duration: number;

    messages: QueryMessage[];

    resultSets?: QueryResultSet[] | null;
};

export type QueryColumn = {
    name: string;

    type: QueryColumnType;
};

export type QueryResultSet = {
    columns: QueryColumn[];

    rows: unknown[][];
};

export type QueryMessage = {
    message: string;

    code?: number | null;

    level?: number | null;

    state?: number | null;

    lineNumber?: number | null;
};

export type ObjectExplorerNodesRequestBag = {
    nodeId: string | undefined;
};

export type ObjectExplorerNodesResponseBag = {
    nodes: ObjectExplorerNodeBag[];
};

export type ObjectExplorerNodeBag = {
    id: string;

    type: ObjectExplorerNodeType;

    name: string;
};

export enum ObjectExplorerNodeType {
    DatabasesFolder = 0,

    Database = 1,

    TablesFolder = 2,

    Table = 3,

    ColumnsFolder = 4,

    Column = 5
}

export type ConnectRequestBag = {
};

export type ConnectResponseBag = {
    databaseName: string;

    oSVersion: string;

    rockVersion: string;

    sqlEdition: string;

    sqlVersion: string;
};

export type GetColumnNamesRequestBag = {
    tableName: string;
};

export type GetColumnNamesResponseBag = {
    columns: string[];
};

export interface IExportSerializer {
    open(resultSet: QueryResultSet): Promise<void>;

    close(): Promise<void>;

    writeRow(columns: QueryColumn[], row: unknown[]): Promise<void>;
}
