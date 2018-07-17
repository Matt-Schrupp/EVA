import { BaseTimeParser, ITimeParserConfiguration } from "../baseTime";
import { DateTimeResolutionResult } from "../utilities";
export declare class TimeParser extends BaseTimeParser {
    constructor(config: ITimeParserConfiguration);
    protected InternalParse(text: string, referenceTime: Date): DateTimeResolutionResult;
    parseIsh(text: string, referenceTime: Date): DateTimeResolutionResult;
}
