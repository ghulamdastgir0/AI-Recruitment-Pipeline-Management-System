import { ApiProperty } from '@nestjs/swagger';

export class CandidateCommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() candidateId!: string;
  @ApiProperty() jobPostingId!: string;
  @ApiProperty() authorUserId!: string;
  @ApiProperty() content!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
