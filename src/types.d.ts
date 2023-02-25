export enum QueryColumnType {
    String = 0
}

export type ExecuteQueryRequest = {
    query: string;
};

export type ExecuteQueryResult = {
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

